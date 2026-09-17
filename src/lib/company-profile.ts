import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "@/lib/config";
import { AnalysisGenerationError } from "@/lib/anthropic";
import type { SourceDoc, SourceRefs } from "@/lib/company-sources";
import {
  PROFILE_FORMAT_VERSION,
  SECTION_ORDER,
  SECTION_TITLES,
  type CompanyProfile,
  type Evidence,
  type ProfileBlock,
  type ProfileParagraph,
  type ProfileSection,
  type SectionKey,
  type VerifiedSegment,
  type VerifiedValueStep,
} from "@/types/company-profile";

/**
 * Building the company profile out of filed documents.
 *
 * The model writes the prose, but it is not trusted to contribute facts. Each
 * paragraph must arrive with the passages it was written from; every passage
 * is searched for in its document, and every figure in the paragraph must
 * appear in one of its verified passages. A paragraph failing either check is
 * dropped. The effect is that the model can explain, connect and order what
 * the filings say, but anything it recalled or computed independently has no
 * supporting passage and cannot reach the page.
 */

// ── matching ─────────────────────────────────────────────────────

/**
 * Filings use curly punctuation and hard line breaks that a quote won't
 * reproduce exactly; neither difference changes what the sentence says. Case
 * and whitespace are normalised for the same reason. Nothing here weakens the
 * check — the words themselves must still match, in order.
 */
export function normalizeForMatch(text: string): string {
  return text
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Too short to prove anything — a few common words appear in any document. */
export const MIN_QUOTE_CHARS = 30;

/**
 * The document a passage genuinely appears in, or null. The named document is
 * checked first, then the rest: citing the wrong document for a real passage
 * is a bookkeeping slip, not a fabrication, and the passage is attributed to
 * wherever it was actually found.
 */
export function findQuote(
  quote: string,
  preferredId: string,
  docs: Pick<SourceDoc, "id" | "text">[],
  minChars = MIN_QUOTE_CHARS
): string | null {
  const trimmed = quote?.trim() ?? "";
  if (trimmed.length < minChars) return null;
  const needle = normalizeForMatch(trimmed);
  const ordered = [...docs].sort((a, b) =>
    a.id === preferredId ? -1 : b.id === preferredId ? 1 : 0
  );
  const hit = ordered.find((d) => normalizeForMatch(d.text).includes(needle));
  return hit?.id ?? null;
}

// Numbers that are names, not figures: form types, item numbers, quarters,
// fiscal-year labels, and product codes like E5, H100 or M365.
const NOT_A_FIGURE =
  /\b(?:10-K|10-Q|8-K|20-F|40-F|Item\s+\d+[A-Z]?|Q[1-4]|FY\s?'?\d{2,4}|H[12]|[A-Za-z]+\d+[A-Za-z\d]*)\b/gi;
// A capitalised name followed by a short number is a product or a date, not a
// figure: "Microsoft 365", "Windows 11", "iPhone 17", "April 26". Words that
// introduce a real period are excluded, so "Fiscal 2026" is still checked, and
// anything followed by a percent sign or decimal stays a figure.
const NAMED_NUMBER =
  /\b(?!(?:Fiscal|Quarter|Year|Q)\b)[A-Z][a-zA-Z]*\s+\d{1,3}\b(?!\s*(?:%|percent|[.,]\d))/g;
const NUMBER = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;

interface Figure {
  value: number;
  hasDecimal: boolean;
  percent: boolean;
  currency: boolean;
}

function figuresIn(text: string, stripNames: boolean): Figure[] {
  const source = stripNames ? text.replace(NOT_A_FIGURE, " ").replace(NAMED_NUMBER, " ") : text;
  const out: Figure[] = [];
  for (const m of source.matchAll(NUMBER)) {
    const raw = m[0];
    const at = m.index ?? 0;
    out.push({
      value: Number(raw.replace(/,/g, "")),
      hasDecimal: raw.includes("."),
      percent: /^\s*(%|percent)/i.test(source.slice(at + raw.length, at + raw.length + 8)),
      currency: /\$\s*$/.test(source.slice(Math.max(0, at - 2), at)),
    });
  }
  return out;
}

/**
 * Is every figure in a paragraph present in its verified passages?
 *
 * Tolerant of how figures get restated — "$193.5 billion" from "$193,479"
 * million, "about 15%" from "14.6%" — through unit rescaling and rounding,
 * and strict about everything else. Years must match exactly. Small bare
 * counts ("three segments" written as 3) are exempt unless they're a
 * percentage or an amount, since that is where invented numbers do harm.
 */
export function figuresSupported(
  text: string,
  quotes: string[],
  // The full documents the passages come from. A year is checked against
  // these rather than just the passage: writing "in fiscal 2026" to name the
  // period is correct even when the quoted sentence itself omits the year,
  // and an invented year still won't appear in the document.
  citedDocuments: string[] = []
): boolean {
  const available = quotes.flatMap((q) => figuresIn(q, false)).map((f) => f.value);
  let documentYears: Set<number> | null = null;
  for (const fig of figuresIn(text, true)) {
    const n = fig.value;
    const isYear = !fig.hasDecimal && n >= 1900 && n <= 2100 && !fig.percent && !fig.currency;
    if (isYear) {
      if (available.includes(n)) continue;
      documentYears ??= new Set(
        citedDocuments.flatMap((d) => [...d.matchAll(/\b(19|20)\d{2}\b/g)].map((m) => Number(m[0])))
      );
      if (!documentYears.has(n)) return false;
      continue;
    }
    if (!fig.hasDecimal && n <= 10 && !fig.percent && !fig.currency) continue;

    const matched = available.some((q) =>
      [1, 1e3, 1e-3, 1e6, 1e-6].some((scale) => {
        const scaled = n * scale;
        const tolerance = Math.max(Math.abs(q) * 0.02, q < 100 ? 0.51 : 0);
        return Math.abs(scaled - q) <= tolerance;
      })
    );
    if (!matched) return false;
  }
  return true;
}

/** Figures in a paragraph that none of its passages contain. */
export function unsupportedFigures(text: string, quotes: string[], citedDocuments: string[] = []): string[] {
  const missing: string[] = [];
  const stripped = text.replace(NOT_A_FIGURE, " ").replace(NAMED_NUMBER, " ");
  for (const m of stripped.matchAll(NUMBER)) {
    const at = (m.index ?? 0) + m[0].length;
    const before = stripped.slice(Math.max(0, (m.index ?? 0) - 2), m.index ?? 0);
    if (!figuresSupported(before + m[0] + stripped.slice(at, at + 8), quotes, citedDocuments)) {
      missing.push(m[0]);
    }
  }
  return missing;
}

export type ParagraphCheck =
  | { ok: true; paragraph: ProfileParagraph }
  | { ok: false; reason: "no verified passage" | "unsupported figure"; detail?: string };

/** Verify one paragraph, saying why when it fails. */
export function checkParagraph(
  paragraph: { text: string; evidence: Evidence[] },
  docs: Pick<SourceDoc, "id" | "text">[]
): ParagraphCheck {
  const text = paragraph.text?.trim() ?? "";
  const evidence: Evidence[] = [];
  for (const e of paragraph.evidence ?? []) {
    const foundIn = findQuote(e.quote, e.sourceId, docs);
    if (foundIn) evidence.push({ quote: e.quote.trim(), sourceId: foundIn });
  }
  if (!text || evidence.length === 0) return { ok: false, reason: "no verified passage" };
  const quotes = evidence.map((e) => e.quote);
  const cited = [...new Set(evidence.map((e) => e.sourceId))]
    .map((id) => docs.find((d) => d.id === id)?.text)
    .filter((t): t is string => !!t);
  if (!figuresSupported(text, quotes, cited)) {
    return { ok: false, reason: "unsupported figure", detail: unsupportedFigures(text, quotes, cited).join(", ") };
  }
  return { ok: true, paragraph: { text, evidence } };
}

/** Verify one paragraph; returns it with only its real passages, or null. */
export function verifyParagraph(
  paragraph: { text: string; evidence: Evidence[] },
  docs: Pick<SourceDoc, "id" | "text">[]
): ProfileParagraph | null {
  const result = checkParagraph(paragraph, docs);
  return result.ok ? result.paragraph : null;
}

// ── diagrams ─────────────────────────────────────────────────────

interface SegmentAi {
  name: string;
  amountAsStated: string;
  period: string;
  quote: string;
  sourceId: string;
}

/** How a stated figure is scaled. Mixing scales would make the chart's shares wrong. */
function scaleOf(asStated: string): "billion" | "million" | "table" {
  if (/billion/i.test(asStated)) return "billion";
  if (/million/i.test(asStated)) return "million";
  return "table";
}

/**
 * Segment figures for the revenue-mix chart, kept only if they hold up. A
 * charted number is a stronger claim than a sentence, so: the passage must be
 * in a document and name the segment; the figure as stated must be inside
 * it; and all segments must share one period and one scale, since shares
 * across mismatched ones are false. Fewer than two consistent segments means
 * no chart.
 *
 * The number charted is parsed from the verified stated figure rather than
 * taken from the model. Asking the model for it separately only added a way
 * to fail: it rescaled "$137,791" (millions) to 137.791 and the chart was
 * dropped over a field that proved nothing the stated figure hadn't.
 */
export function verifySegments(
  segments: SegmentAi[],
  docs: Pick<SourceDoc, "id" | "text">[],
  onReject?: (segment: string, reason: string) => void
): VerifiedSegment[] {
  const reject = (seg: SegmentAi, reason: string) => {
    onReject?.(seg.name, reason);
    return null;
  };

  const passing: VerifiedSegment[] = [];
  for (const seg of segments) {
    const result = ((): VerifiedSegment | null => {
      // A table row can be short ("Graphics 22,459 14,304"); naming the
      // segment and carrying the figure is what makes it meaningful.
      const foundIn = findQuote(seg.quote, seg.sourceId, docs, 12);
      if (!foundIn) return reject(seg, "quote not in any document");
      if (!normalizeForMatch(seg.quote).includes(normalizeForMatch(seg.name))) {
        return reject(seg, "segment name not in quote");
      }
      const stated = (seg.amountAsStated ?? "").replace(/[^0-9.]/g, "").replace(/\.$/, "");
      if (!stated) return reject(seg, "no figure stated");
      if (!seg.quote.replace(/[,\s$]/g, "").includes(stated)) {
        return reject(seg, "figure not in quote");
      }
      const amount = Number.parseFloat(stated);
      if (!(Number.isFinite(amount) && amount > 0)) return reject(seg, "figure isn't a positive number");
      return { ...seg, amount, sourceId: foundIn };
    })();
    if (result) passing.push(result);
  }

  if (passing.length < 2) {
    if (segments.length > 0) onReject?.("(chart)", `only ${passing.length} segment(s) verified`);
    return [];
  }

  const counts = new Map<string, number>();
  for (const seg of passing) counts.set(seg.period, (counts.get(seg.period) ?? 0) + 1);
  const period = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const samePeriod = passing.filter((seg) => seg.period === period);
  const scales = new Set(samePeriod.map((seg) => scaleOf(seg.amountAsStated)));
  if (samePeriod.length < 2 || scales.size !== 1) {
    onReject?.("(chart)", scales.size !== 1 ? "figures on mixed scales" : "figures span different periods");
    return [];
  }
  return samePeriod.sort((a, b) => b.amount - a.amount);
}

// ── schema ───────────────────────────────────────────────────────

const SECTION_BRIEFS: Record<SectionKey, string> = {
  overview:
    "2-3 blocks totalling 3-5 paragraphs: what the company is and does in practice; its scale (revenue, employees, geographic reach, where stated); how it is organised into segments; and what the company itself says distinguishes it.",
  products:
    "One block per major product line, segment or service, with heading = its name. 1-3 paragraphs each: what it is and what problem it solves for the user, who uses it, how it is sold, and how it has been performing according to the documents.",
  model:
    "2-4 blocks totalling 4-6 paragraphs: every material revenue stream; how each is priced and contracted (one-time sale, subscription, licence, consumption, royalty, advertising, concentrate sales, etc.); where margins are higher or lower, as stated; seasonality; and what drives revenue up or down.",
  customers:
    "2-4 blocks: who the customers are (consumers, businesses, governments, OEMs, distributors); customer concentration and significant customers as disclosed; what customers are buying it for, in the company's terms; and the channels through which they are reached.",
  competition:
    "2-4 blocks: the competitors the documents name for each business; the basis on which the company says competition happens (price, performance, ecosystem, brand, scale); the advantages it claims; and the competitive threats it discloses.",
  operations:
    "2-4 blocks: how products and services are made or delivered (own manufacturing, contract manufacturers, data centres, bottling partners, stores); key suppliers and partners and any dependence on them; workforce; geographic footprint; research and development and intellectual property.",
  recent:
    "2-4 blocks drawing mainly on the 10-Q and earnings releases: results for the most recent quarter(s) — revenue, profitability, segment performance — and the reasons management gives; plus any guidance or outlook stated. Name the period for every figure.",
  strategy:
    "2-4 blocks: priorities management has stated; investments and capital commitments; capital return plans; new products, markets or initiatives announced. Stated intentions only — never infer a plan from a trend.",
  risks:
    "4-6 blocks, each heading naming one material risk as management frames it, with 1-2 paragraphs explaining it and why it matters to this business specifically. Choose risks particular to this company, not boilerplate that would apply to any business.",
};

type Group = { name: string; sections: SectionKey[]; diagrams: boolean };

/**
 * Three calls in parallel rather than one: nine sections of long-form prose
 * is too much output for a single structured response to return promptly,
 * and splitting keeps each call's grammar small.
 */
const GROUPS: Group[] = [
  { name: "the business", sections: ["overview", "products", "model"], diagrams: true },
  { name: "the market", sections: ["customers", "competition", "operations"], diagrams: false },
  { name: "the direction", sections: ["recent", "strategy", "risks"], diagrams: false },
];

function schemaFor(group: Group, ids: [string, ...string[]]) {
  const sourceId = z.enum(ids).describe("The id of the document the passage is copied from");
  const evidence = z.object({
    quote: z
      .string()
      .describe("A passage copied EXACTLY, character for character, from the document. Searched for in the source; a paraphrase is discarded."),
    sourceId,
  });
  const paragraph = z.object({
    text: z.string().describe("3-6 sentences of explanatory prose for this paragraph"),
    evidence: z
      .array(evidence)
      .describe("1-5 passages this paragraph was written from; every figure in the text must appear in one of them, so include a passage for each figure"),
  });
  const block = z.object({
    heading: z.string().describe('A short subheading, or "" when the section needs none'),
    paragraphs: z.array(paragraph),
  });

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const key of group.sections) shape[key] = z.array(block).describe(SECTION_BRIEFS[key]);
  if (group.diagrams) {
    shape.valueChain = z
      .array(
        z.object({
          stage: z.string().describe("2-4 word label"),
          detail: z.string().describe("One plain sentence on what happens at this step"),
          quote: z.string().describe("The supporting passage, copied exactly"),
          sourceId,
        })
      )
      .describe("3-5 steps showing the mechanism by which this company creates value and gets paid");
    shape.segments = z
      .array(
        z.object({
          name: z.string(),
          amountAsStated: z.string().describe('The revenue figure exactly as written in the quote, e.g. "$193,479" or "$11.8 billion"'),
          period: z.string().describe('e.g. "Fiscal 2026"'),
          quote: z.string().describe("The sentence or table row containing the figure, copied exactly"),
          sourceId,
        })
      )
      .describe("Revenue per reportable segment for the most recent full fiscal year, only where stated. Empty if not stated.");
  }
  return z.object(shape);
}

// ── prompt ───────────────────────────────────────────────────────

function documentsBlock(docs: SourceDoc[]): string {
  return docs
    .map((d) => `=== DOCUMENT id="${d.id}" — ${d.label} ===\n"""\n${d.text}\n"""`)
    .join("\n\n");
}

function buildPrompt(ticker: string, name: string, docs: SourceDoc[], group: Group): string {
  const diagramRules = group.diagrams
    ? `

DIAGRAM DATA
- "segments": copy each figure into "amountAsStated" exactly as written in your quote (keep "$", commas and words like "billion"). One period for every segment. If a table puts a segment's name and figures on separate lines, quote those lines together exactly as they appear. Return an empty array if no document states segment revenue.
- "valueChain": the mechanism by which THIS company creates value and gets paid — who does what, and where money changes hands — specific enough that it could not describe another company. Avoid generic steps ("generate revenue", "reinvest in R&D", "return capital") unless the documents make them central to how this business works. Each step needs its own passage.`
    : "";

  return `You are writing part of an in-depth company profile of ${name} (${ticker}) for an investor who wants to genuinely understand how this business works — what it sells, how it earns, who buys, who it competes with, how it is doing and where it is heading. Write so that someone who knew nothing about the company would finish these sections understanding it well.

Your ONLY sources are the filed documents below: the latest annual report (10-K) sections, the latest quarterly report (10-Q) MD&A, and recent earnings releases.

${documentsBlock(docs)}

YOU ARE WRITING: ${group.sections.map((s) => `"${s}" (${SECTION_TITLES[s]})`).join(", ")}.

HOW TO WRITE
- Write real explanatory paragraphs of 3-6 sentences. Connect facts into an explanation of how the business works and why it matters. Explain any industry term in plain words the first time it appears.
- Be specific to this company: name its products, segments, customers, competitors and partners as the documents do. Never write generic industry description.
- Where documents disagree on a current figure, use the most recent document and say which period the figure refers to.

THE RULES THAT DECIDE WHETHER A PARAGRAPH IS PUBLISHED
1. Every paragraph needs 1-5 "evidence" passages copied EXACTLY from the documents, each with the id of the document it came from. Each is searched for in that document. Copy — do not reconstruct.
2. Every figure in a paragraph — amounts, percentages, growth rates, per-share amounts, counts — must appear in one of that paragraph's evidence passages. Before finishing a paragraph, check each figure you wrote and make sure you quoted the passage it came from; a paragraph with five figures may need four or five passages. Copy figures; do not calculate new ones (no totals, shares or differences the documents don't state). A paragraph containing a figure absent from its passages is deleted.
3. Use nothing from outside these documents — not a figure, product, competitor or event you know from elsewhere.
Fewer, fully supported paragraphs beat more paragraphs that get deleted.${diagramRules}`;
}

// ── generation ───────────────────────────────────────────────────

async function generateGroup(
  client: Anthropic,
  ticker: string,
  name: string,
  docs: SourceDoc[],
  group: Group,
  timeoutMs: number
): Promise<Record<string, unknown>> {
  const ids = docs.map((d) => d.id) as [string, ...string[]];
  const schema = schemaFor(group, ids);
  const stream = client.messages.stream(
    {
      model: config.anthropicModel,
      max_tokens: 32000,
      messages: [{ role: "user", content: buildPrompt(ticker, name, docs, group) }],
      output_config: { format: zodOutputFormat(schema) },
    },
    { timeout: timeoutMs }
  );
  const response = await stream.finalMessage();
  if (response.stop_reason === "refusal") {
    throw new AnalysisGenerationError("The model declined to build this company profile.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AnalysisGenerationError(`The "${group.name}" part of the profile ran too long. Please try again.`);
  }
  const block = response.content.find((b) => b.type === "text");
  if (!block || block.type !== "text") {
    throw new AnalysisGenerationError("The company profile came back empty. Please try again.");
  }
  return schema.parse(JSON.parse(block.text)) as Record<string, unknown>;
}

interface BuildOptions {
  onSegmentReject?: (segment: string, reason: string) => void;
  /** Called for each dropped paragraph, so a high discard rate can be diagnosed. */
  onParagraphDiscard?: (
    section: SectionKey,
    paragraph: { text: string; evidence: Evidence[] },
    reason: string,
    detail?: string
  ) => void;
  /** Per-call timeout. Backfills can afford far longer than a web request. */
  timeoutMs?: number;
}

/** Generate, verify and assemble a profile from already-fetched documents. */
export async function buildCompanyProfile(
  ticker: string,
  companyName: string,
  refs: SourceRefs,
  docs: SourceDoc[],
  options: BuildOptions = {}
): Promise<CompanyProfile> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
  const timeoutMs = options.timeoutMs ?? 280_000;

  let outputs: Record<string, unknown>[];
  try {
    outputs = await Promise.all(
      GROUPS.map((g) => generateGroup(client, ticker, companyName, docs, g, timeoutMs))
    );
  } catch (err) {
    if (err instanceof AnalysisGenerationError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AnalysisGenerationError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AnalysisGenerationError("Anthropic rate limit reached. Wait a minute and try again.");
    }
    if (err instanceof Anthropic.APIError && err.status === 400) {
      throw new AnalysisGenerationError(
        "Anthropic rejected the request — usually a credit balance issue. Check Plans & Billing."
      );
    }
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new AnalysisGenerationError("Building the company profile timed out. Please try again.");
    }
    throw new AnalysisGenerationError("Couldn't build the company profile. Please try again.");
  }
  const merged = Object.assign({}, ...outputs) as Record<string, unknown>;

  let discarded = 0;
  const sections: ProfileSection[] = SECTION_ORDER.map((key) => {
    const rawBlocks = (merged[key] as { heading: string; paragraphs: ProfileParagraph[] }[]) ?? [];
    const blocks: ProfileBlock[] = [];
    for (const raw of rawBlocks) {
      const paragraphs: ProfileParagraph[] = [];
      for (const p of raw.paragraphs ?? []) {
        const result = checkParagraph(p, docs);
        if (result.ok) {
          paragraphs.push(result.paragraph);
        } else {
          discarded++;
          options.onParagraphDiscard?.(key, p, result.reason, result.detail);
        }
      }
      if (paragraphs.length > 0) {
        blocks.push({ heading: raw.heading?.trim() ? raw.heading.trim() : null, paragraphs });
      }
    }
    return { key, title: SECTION_TITLES[key], blocks };
  });

  const valueChain: VerifiedValueStep[] = [];
  for (const step of (merged.valueChain as VerifiedValueStep[]) ?? []) {
    const foundIn = findQuote(step.quote, step.sourceId, docs);
    if (foundIn && figuresSupported(step.detail, [step.quote])) {
      valueChain.push({ ...step, sourceId: foundIn });
    } else {
      discarded++;
    }
  }

  const segments = verifySegments(
    (merged.segments as SegmentAi[]) ?? [],
    docs,
    options.onSegmentReject
  );

  // Only list documents something on the page actually cites.
  const cited = new Set<string>([
    ...sections.flatMap((s) => s.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.evidence.map((e) => e.sourceId)))),
    ...valueChain.map((v) => v.sourceId),
    ...segments.map((s) => s.sourceId),
  ]);

  const business = docs.find((d) => d.id === "10k-business");
  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    ticker,
    companyName,
    generatedAt: new Date().toISOString(),
    model: config.anthropicModel,
    filing: {
      url: refs.tenK.primaryUrl,
      accession: refs.tenK.accession,
      filedDate: refs.tenK.filedDate,
    },
    sources: docs
      .filter((d) => cited.has(d.id))
      .map(({ id, kind, label, filedDate, url }) => ({ id, kind, label, filedDate, url })),
    sourceKey: refs.key,
    opening: openingOf(business?.text ?? null),
    sections,
    segments,
    valueChain,
    discarded,
  };
}

// ── opening ──────────────────────────────────────────────────────

/**
 * The filing's own first substantial paragraph. Companies open Item 1 by
 * saying what they are — NVIDIA's begins "NVIDIA pioneered accelerated
 * computing..." — so the most accurate summary available is simply theirs,
 * quoted. No model involvement, nothing to fabricate.
 */
export function openingOf(business: string | null): string | null {
  if (!business) return null;
  for (const line of business.split("\n")) {
    if (line.length < 180) continue;
    if (isFilingBoilerplate(line)) continue;
    return line.length > 1200 ? `${line.slice(0, 1200).trim()}…` : line;
  }
  return null;
}

/**
 * Paragraphs that are about the filing rather than the business. Microsoft's
 * Item 1 opens with one — quoting "Our Internet address is www.microsoft.com"
 * as the company's description of itself is worse than quoting nothing.
 */
function isFilingBoilerplate(line: string): boolean {
  return (
    /internet address|investor relations website|available free of charge/i.test(line) ||
    /incorporated by reference|not part of.{0,20}this (?:annual )?report/i.test(line) ||
    /forward-looking statements within the meaning|private securities litigation reform/i.test(line) ||
    /^\s*[•·]/.test(line)
  );
}
