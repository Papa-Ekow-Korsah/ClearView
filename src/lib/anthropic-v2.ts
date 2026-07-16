import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "@/lib/config";
import { AnalysisGenerationError, stripJsonNoise } from "@/lib/anthropic";
import { z } from "zod";
import {
  coreSectionSchema,
  verdictSectionSchema,
  earningsSectionSchema,
  ratiosSectionSchema,
  dealsSectionSchema,
  macroSectionSchema,
  RATIO_LABELS,
  type AiNoteV2,
  type DualText,
  type RatioValue,
  type EpsSurprise,
} from "@/types/analysis-v2";
import type { PeerRow, Snapshot } from "@/types/analysis";
import type { NewsItem } from "@/lib/finnhub";

export interface NoteInputV2 {
  ticker: string;
  companyName: string;
  industry: string | null;
  snapshot: Snapshot;
  subjectMetrics: Record<string, number | string | null>;
  peers: PeerRow[];
  ratioValues: RatioValue[];
  epsSurprises: EpsSurprise[];
  news: NewsItem[];
}

function n(v: number | null, suffix = ""): string {
  return v === null ? "n/a" : `${v.toFixed(2)}${suffix}`;
}

function buildPrompt(input: NoteInputV2): string {
  const { ticker, companyName, industry, snapshot, peers, ratioValues, epsSurprises, news } = input;

  const peerTable = peers
    .map(
      (p) =>
        `${p.ticker}${p.isSubject ? " (subject)" : ""} | ${p.name} | mktCap $${n(p.marketCap)}M | revGrowth ${n(p.revenueGrowthTTM, "%")} | grossMargin ${n(p.grossMarginTTM, "%")} | opMargin ${n(p.operatingMarginTTM, "%")} | P/E ${n(p.peTTM, "x")} | EV/EBITDA ${n(p.evEbitdaTTM, "x")} | D/E ${n(p.debtToEquity, "x")}`
    )
    .join("\n");

  const ratioTable = ratioValues
    .map(
      (r) =>
        `${r.key} (${RATIO_LABELS[r.key]}): subject ${n(r.value)} | peers: ${r.peerValues
          .map((p) => `${p.ticker} ${n(p.value)}`)
          .join(", ")}`
    )
    .join("\n");

  const epsTable = epsSurprises
    .slice(0, 4)
    .map(
      (e) =>
        `${e.period}: actual ${e.actual ?? "n/a"} vs est ${e.estimate ?? "n/a"} (${
          e.surprisePercent != null ? `${e.surprisePercent > 0 ? "+" : ""}${e.surprisePercent.toFixed(1)}%` : "n/a"
        })`
    )
    .join("\n");

  const headlines = news
    .slice(0, 15)
    .map(
      (item) =>
        `- [${new Date(item.datetime * 1000).toISOString().slice(0, 10)}] ${item.headline} (${item.source})`
    )
    .join("\n");

  return `You are a senior equity analyst producing a full six-section research note for ${companyName} (${ticker}) — a deep dive covering overview, earnings, ratios, deals & contracts, macro, and verdict.

Every narrative field must be written twice: "analyst" voice (dense, specific numbers, named peers) and "explain" voice (plain English, one analogy, then apply it to this company). Both voices must be specific to THIS company right now — never generic.

VERIFIED DATA (from market data APIs — treat as ground truth):
Price: ${snapshot.price ?? "n/a"} ${snapshot.currency ?? ""} (day ${n(snapshot.dayChangePct, "%")}) | Market cap $${n(snapshot.marketCap)}M | 52wk ${snapshot.week52Low ?? "n/a"}–${snapshot.week52High ?? "n/a"} | Industry: ${industry ?? "unknown"}

Peer comparison:
${peerTable}

Ratio values (your ratios[] interpretation must cover exactly these keys, in this order — the app displays these exact values next to your text):
${ratioTable}

EPS actual vs estimate, last quarters:
${epsTable || "n/a"}

Recent news (last 30 days):
${headlines || "none"}

FOR EVERYTHING ELSE (segment revenue, guidance figures, balance sheet, deals, management, macro readings): use your knowledge of the company plus the news above. Be as accurate as you can; where genuinely unsure, use round figures and hedge in the text rather than inventing precision. The UI labels these sections as AI-sourced.

Rules:
- Signal must follow from the data; signalReason packs the key numbers into one sentence.
- Deals: prefer deals visible in the news headlines; mark anything not publicly confirmed as "unconfirmed" or "risk".
- Catalysts: time-bound and nearest-first. Macro factors: name the specific transmission channel to this company.
- Verdict language: "the analysis suggests…", never "you should…".
- Plain prose only inside fields — no JSON syntax, braces, or markup.`;
}

function clean(d: DualText): DualText {
  return { analyst: stripJsonNoise(d.analyst), explain: stripJsonNoise(d.explain) };
}

/** Walk the note and sanitize every dual-text field. */
function sanitize(note: AiNoteV2): AiNoteV2 {
  return {
    ...note,
    overview: note.overview,
    earnings: {
      ...note.earnings,
      beatBanner: clean(note.earnings.beatBanner),
      balanceSheet: { ...note.earnings.balanceSheet, note: clean(note.earnings.balanceSheet.note) },
      cashFlow: note.earnings.cashFlow.map((c) => ({ ...c, note: clean(c.note) })),
      guidance: { ...note.earnings.guidance, narrative: clean(note.earnings.guidance.narrative) },
      summary: clean(note.earnings.summary),
    },
    ratios: note.ratios.map((r) => ({ ...r, peerNote: clean(r.peerNote), explain: clean(r.explain) })),
    deals: note.deals.map((d) => ({ ...d, subtitle: clean(d.subtitle), body: clean(d.body) })),
    management: note.management.map((m) => ({ ...m, body: clean(m.body) })),
    macro: {
      ...note.macro,
      summary: clean(note.macro.summary),
      factors: note.macro.factors.map((f) => ({ ...f, body: clean(f.body) })),
    },
    verdict: {
      ...note.verdict,
      text: clean(note.verdict.text),
      scorecard: note.verdict.scorecard.map((s) => ({ ...s, desc: clean(s.desc) })),
      catalysts: note.verdict.catalysts.map((c) => ({ ...c, desc: clean(c.desc) })),
      recommendation: {
        ...note.verdict.recommendation,
        text: clean(note.verdict.recommendation.text),
      },
    },
  };
}

/**
 * One combined schema exceeds the structured-outputs grammar-size limit, so
 * the note is generated as five parallel section calls and assembled here.
 * Core (signal/overview) and verdict share a call so they can't contradict.
 */
const coreVerdictSchema = z.object({
  ...coreSectionSchema.shape,
  ...verdictSectionSchema.shape,
});

const SECTION_PROMPTS = {
  coreVerdict:
    'Produce the OVERVIEW and VERDICT sections: the overall signal with its one-sentence data-packed reason, conviction, bull/bear cases, street consensus, recent analyst moves, the verdict synthesis, a 6-dimension scorecard, 2-3 time-bounded catalysts (nearest first), and the research recommendation with chips. Verdict language: "the analysis suggests…", never "you should…".',
  earnings:
    "Produce the EARNINGS section: latest reported quarter with beat banner, revenue vs estimate, 3-4 revenue segments with relative bar sizes, 3-4 margin rows, balance sheet snapshot, 2-3 cash flow rows, next-quarter guidance, and the overall summary.",
  ratios:
    "Produce the RATIOS section: exactly one interpretation entry per provided ratio key, in the same order as provided. The app renders the verified values next to your text — interpret those exact values against the peer values given.",
  deals:
    'Produce the DEALS & CONTRACTS and MANAGEMENT sections: 3-4 deals from the last 12 months (prefer ones visible in the news headlines; mark anything not publicly confirmed "unconfirmed" or "risk") and 2 key executives.',
  macro:
    "Produce the MACRO section: net macro verdict for this specific company, a net-impact meter position, and 3-4 macro factors each naming the specific transmission channel to this company.",
} as const;

async function generateSection<S extends z.ZodType>(
  client: Anthropic,
  basePrompt: string,
  sectionPrompt: string,
  schema: S
): Promise<z.infer<S>> {
  const stream = client.messages.stream({
    model: config.anthropicModel,
    max_tokens: 12000,
    messages: [
      { role: "user", content: `${basePrompt}\n\nYOUR TASK:\n${sectionPrompt}` },
    ],
    output_config: { format: zodOutputFormat(schema) },
  });
  const response = await stream.finalMessage();

  if (response.stop_reason === "refusal") {
    throw new AnalysisGenerationError("The model declined to generate this analysis.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new AnalysisGenerationError(
      "A section was cut off mid-generation (token limit). Try again."
    );
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") {
    throw new AnalysisGenerationError("Empty model response for a section. Try again.");
  }
  const parsed = schema.safeParse(JSON.parse(text.text));
  if (!parsed.success) {
    throw new AnalysisGenerationError(
      "A section response did not match the expected format. Try again."
    );
  }
  return parsed.data;
}

/** Generate the six-tab rich note via five parallel structured calls. */
export async function generateAiNoteV2(input: NoteInputV2): Promise<AiNoteV2> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const base = buildPrompt(input);

  try {
    const [coreVerdict, earnings, ratios, deals, macro] = await Promise.all([
      generateSection(client, base, SECTION_PROMPTS.coreVerdict, coreVerdictSchema),
      generateSection(client, base, SECTION_PROMPTS.earnings, earningsSectionSchema),
      generateSection(client, base, SECTION_PROMPTS.ratios, ratiosSectionSchema),
      generateSection(client, base, SECTION_PROMPTS.deals, dealsSectionSchema),
      generateSection(client, base, SECTION_PROMPTS.macro, macroSectionSchema),
    ]);

    return sanitize({
      ...coreVerdict,
      ...earnings,
      ...ratios,
      ...deals,
      ...macro,
    });
  } catch (err) {
    if (err instanceof AnalysisGenerationError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AnalysisGenerationError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AnalysisGenerationError("Anthropic rate limit reached. Wait a minute and try again.");
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new AnalysisGenerationError(
        `Model "${config.anthropicModel}" was not found. Check ANTHROPIC_MODEL.`
      );
    }
    if (err instanceof Anthropic.APIError) {
      throw new AnalysisGenerationError(`Anthropic API error (HTTP ${err.status}): ${err.message}`);
    }
    if (err instanceof SyntaxError) {
      throw new AnalysisGenerationError("Model returned malformed JSON. Try again.");
    }
    throw err;
  }
}
