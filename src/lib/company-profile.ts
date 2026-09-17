import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "@/lib/config";
import { AnalysisGenerationError } from "@/lib/anthropic";
import type { TenK } from "@/lib/tenk";
import {
  companyProfileSchema,
  PROFILE_FORMAT_VERSION,
  SECTION_TITLES,
  type Claim,
  type CompanyProfile,
  type CompanyProfileAi,
  type CompanyProfileSection,
  type SectionKey,
  type SegmentFigure,
  type VerifiedClaim,
  type VerifiedSegment,
  type VerifiedValueStep,
} from "@/types/company-profile";

/**
 * Building the company profile out of the 10-K.
 *
 * The model's only job here is selection and phrasing: decide which parts of
 * Item 1 and Item 7 matter, and say why. It is not permitted to contribute
 * facts. Every claim must arrive with the filing sentence that supports it,
 * and `verifyClaim` below checks that sentence actually exists in the source
 * before the claim is allowed into the profile.
 */

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
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Too short to prove anything — three common words appear in any document. */
const MIN_QUOTE_CHARS = 40;

/**
 * Does this quote genuinely appear in the filing? A claim that fails is
 * discarded rather than flagged: the requirement is that nothing unsourced
 * reaches the reader, and a visible "unverified" badge would still be putting
 * an invented sentence on the page.
 */
export function verifyClaim(
  claim: Claim,
  sources: { business: string | null; mdna: string | null }
): boolean {
  const quote = claim.quote?.trim() ?? "";
  if (quote.length < MIN_QUOTE_CHARS) return false;
  return quoteFound(quote, claim.source, sources);
}

/** Whether a quote appears verbatim (after normalisation) in either section. */
function quoteFound(
  quote: string,
  source: Claim["source"],
  sources: { business: string | null; mdna: string | null }
): boolean {
  const needle = normalizeForMatch(quote);
  // Check the named section first, then the other: the model occasionally
  // mislabels which item a sentence came from, which is a bookkeeping slip
  // rather than a fabrication, so it shouldn't cost a real quote.
  const ordered =
    source === "mdna"
      ? [sources.mdna, sources.business]
      : [sources.business, sources.mdna];

  return ordered.some((text) => text !== null && normalizeForMatch(text).includes(needle));
}

/** How a stated figure is scaled. Mixing scales would make the chart's shares wrong. */
function scaleOf(asStated: string): "billion" | "million" | "table" {
  if (/billion/i.test(asStated)) return "billion";
  if (/million/i.test(asStated)) return "million";
  return "table";
}

/**
 * Segment figures for the revenue-mix chart, kept only if they hold up.
 *
 * A charted number is a stronger claim than a sentence, so it gets more
 * checks than a claim does:
 *  - the quote must appear in the filing (same check as every claim);
 *  - the figure, exactly as stated, must appear inside that quote — so it
 *    was read off the filing, not recalled;
 *  - the numeric value must match the stated figure — so it wasn't misread;
 *  - every surviving segment must share one period and one scale, because
 *    shares computed across mismatched periods or units are simply false.
 * Anything short of two consistent segments means no chart rather than a
 * misleading one.
 */
export function verifySegments(
  segments: SegmentFigure[],
  tenK: Pick<TenK, "business" | "mdna" | "url">,
  // Reports why each figure was dropped. Without it, "no chart" is
  // indistinguishable from "the filing gave no segment figures".
  onReject?: (segment: string, reason: string) => void
): VerifiedSegment[] {
  const reject = (seg: SegmentFigure, reason: string) => {
    onReject?.(seg.name, reason);
    return false;
  };

  const passing = segments.filter((seg) => {
    if (!(seg.amount > 0)) return reject(seg, "non-positive amount");
    // A real table row can be very short ("Graphics 22,459 14,304 8,155 57 %"),
    // so the claim length floor doesn't apply. What makes a short row
    // meaningful instead is that it names this segment AND carries the figure.
    if (!seg.quote || !quoteFound(seg.quote, seg.source, tenK)) {
      return reject(seg, "quote not in filing");
    }
    if (!normalizeForMatch(seg.quote).includes(normalizeForMatch(seg.name))) {
      return reject(seg, "segment name not in quote");
    }

    const statedDigits = seg.amountAsStated.replace(/[^0-9.]/g, "").replace(/\.$/, "");
    if (!statedDigits) return reject(seg, "no figure stated");
    const quoteDigits = seg.quote.replace(/[,\s$]/g, "");
    if (!quoteDigits.includes(statedDigits)) return reject(seg, "figure not in quote");

    const parsed = Number.parseFloat(statedDigits);
    if (!(Number.isFinite(parsed) && Math.abs(parsed - seg.amount) <= Math.abs(parsed) * 0.005)) {
      return reject(seg, "amount doesn't match stated figure");
    }
    return true;
  });

  if (passing.length < 2) {
    if (segments.length > 0) onReject?.("(chart)", `only ${passing.length} segment(s) verified`);
    return [];
  }

  // Keep the dominant period, then require one scale across what's left.
  const counts = new Map<string, number>();
  for (const seg of passing) counts.set(seg.period, (counts.get(seg.period) ?? 0) + 1);
  const period = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const samePeriod = passing.filter((seg) => seg.period === period);

  const scales = new Set(samePeriod.map((seg) => scaleOf(seg.amountAsStated)));
  if (samePeriod.length < 2 || scales.size !== 1) {
    onReject?.("(chart)", scales.size !== 1 ? "figures on mixed scales" : "figures span different periods");
    return [];
  }

  return samePeriod
    .sort((a, b) => b.amount - a.amount)
    .map((seg) => ({ ...seg, sourceUrl: tenK.url }));
}

function buildPrompt(ticker: string, name: string, tenK: TenK): string {
  return `You are writing the "know this company" section of an equity research note on ${name} (${ticker}), for a reader who wants to finish it understanding how this business actually works.

Your source is the company's own Form 10-K, filed ${tenK.filedDate}. Two sections are quoted below in full.

=== ITEM 1 — BUSINESS ===
"""
${tenK.business ?? "(not available in this filing)"}
"""

=== ITEM 7 — MANAGEMENT'S DISCUSSION AND ANALYSIS ===
"""
${tenK.mdna ?? "(not available in this filing)"}
"""

THE ONE RULE: every claim you make must be supported by a sentence that appears in the text above, and you must copy that sentence into the "quote" field EXACTLY as written — same words, same order, same numbers. Each quote is checked by searching for it in the source document. A quote that cannot be found is deleted along with its claim, so a paraphrase loses you the point entirely. Copy, do not reconstruct.

What this means in practice:
- Do not use anything you know about ${name} from outside this filing. Not one figure, not one product name, not one competitor. If it isn't above, it doesn't exist for this task.
- Prefer sentences that are specific: segment economics, named products, named competitors, customer concentration, pricing and contract structure, stated strategic priorities.
- Choose quotes that are self-contained. A sentence beginning "This increased 12%" proves nothing on its own; pick the one that says what increased.
- If a section of the filing genuinely doesn't support 4 claims, return fewer. Fewer real claims beats padding.

Write "point" in your own words — a specific, concrete statement a reader learns something from. Never generic ("Apple is a technology company that makes consumer electronics"); always operational ("Services gross margin runs roughly double the product margin, so mix shift toward Services lifts total margin even when unit sales are flat").

For "plans", use only intentions management has actually stated — capital allocation commitments, announced investments, named initiatives. Never infer a plan from a trend.

DIAGRAM DATA — the same rule applies, with extra checks:
- "segments": revenue for each reportable segment, for the most recent full fiscal year, only if the filing states it. Copy the figure into "amountAsStated" exactly as written in your quote (keep "$", commas, and words like "billion"); put the plain number of that figure, unscaled, in "amount". Use one period for every segment. The quote may be a table row; if a table puts the segment name and its figures on separate lines, quote those lines together, in order, exactly as they appear — the name and the figure must both be inside the quote. If the filing gives no segment revenue figures, return an empty array — do not estimate.
- "valueChain": 3-5 steps, in order, showing the mechanism by which THIS company creates value and gets paid: who does what, and where money changes hands. It should be specific enough that it could not describe a different company. Do NOT use generic corporate steps — "generate revenue", "grow sales", "reinvest in R&D", "return capital to shareholders" — unless the filing makes that step central to how this particular business works. A good chain names the actual parties and the actual thing being sold; for a hypothetical franchise restaurant chain it would be: develop the brand and menu → license it to franchisees for an upfront fee → franchisees run the restaurants → franchisor collects a percentage royalty on their sales. Each step needs its own supporting quote. Keep "stage" to 2-4 words.`;
}

const TIMEOUT_MS = 180_000;

/**
 * Generate and verify a profile from a 10-K the caller has already fetched.
 * Fetching is the caller's job so it can tell the reader WHY there is no
 * profile — unreachable, no such filing, or unparsable are different claims.
 */
export async function buildCompanyProfile(
  ticker: string,
  companyName: string,
  tenK: TenK,
  options: { onSegmentReject?: (segment: string, reason: string) => void } = {}
): Promise<CompanyProfile> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });

  let ai: CompanyProfileAi;
  try {
    const stream = client.messages.stream(
      {
        model: config.anthropicModel,
        max_tokens: 16000,
        messages: [{ role: "user", content: buildPrompt(ticker, companyName, tenK) }],
        output_config: { format: zodOutputFormat(companyProfileSchema) },
      },
      { timeout: TIMEOUT_MS }
    );
    const response = await stream.finalMessage();
    if (response.stop_reason === "refusal") {
      throw new AnalysisGenerationError("The model declined to build this company profile.");
    }
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") {
      throw new AnalysisGenerationError("The company profile came back empty. Please try again.");
    }
    ai = companyProfileSchema.parse(JSON.parse(block.text));
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
    throw new AnalysisGenerationError("Couldn't build the company profile. Please try again.");
  }

  const sourceLabel = `10-K filed ${tenK.filedDate}`;
  let discarded = 0;

  const sections: CompanyProfileSection[] = (
    Object.keys(SECTION_TITLES) as SectionKey[]
  ).map((key) => {
    const kept: VerifiedClaim[] = [];
    for (const claim of ai[key] ?? []) {
      if (verifyClaim(claim, tenK)) {
        kept.push({ ...claim, sourceUrl: tenK.url, sourceLabel });
      } else {
        discarded++;
      }
    }
    return { key, title: SECTION_TITLES[key], claims: kept };
  });

  const valueChain: VerifiedValueStep[] = [];
  for (const step of ai.valueChain ?? []) {
    if (verifyClaim({ point: step.detail, quote: step.quote, source: step.source }, tenK)) {
      valueChain.push({ ...step, sourceUrl: tenK.url });
    } else {
      discarded++;
    }
  }

  return {
    formatVersion: PROFILE_FORMAT_VERSION,
    ticker,
    companyName,
    generatedAt: new Date().toISOString(),
    model: config.anthropicModel,
    filing: { url: tenK.url, accession: tenK.accession, filedDate: tenK.filedDate },
    opening: openingOf(tenK.business),
    sections,
    segments: verifySegments(ai.segments ?? [], tenK, options.onSegmentReject),
    valueChain,
    discardedClaims: discarded,
  };
}

/**
 * The filing's own first substantial paragraph. Companies open Item 1 by
 * saying what they are — NVIDIA's begins "NVIDIA pioneered accelerated
 * computing..." — so the most accurate summary available is simply theirs,
 * quoted. No model involvement, nothing to fabricate.
 */
export function openingOf(business: string | null): string | null {
  if (!business) return null;
  for (const line of business.split("\n")) {
    // Skip the heading itself and short sub-headings like "Our Company".
    if (line.length < 180) continue;
    if (isFilingBoilerplate(line)) continue;
    return line.length > 1200 ? `${line.slice(0, 1200).trim()}…` : line;
  }
  return null;
}

/**
 * Paragraphs that are about the filing rather than the business. Every 10-K
 * carries them, and Microsoft's Item 1 opens with one — quoting "Our Internet
 * address is www.microsoft.com" as the company's description of itself is
 * worse than quoting nothing.
 */
function isFilingBoilerplate(line: string): boolean {
  return (
    /internet address|investor relations website|available free of charge/i.test(line) ||
    /incorporated by reference|not part of.{0,20}this (?:annual )?report/i.test(line) ||
    /forward-looking statements within the meaning|private securities litigation reform/i.test(line) ||
    /^\s*[•·]/.test(line)
  );
}
