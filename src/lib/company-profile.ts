import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "@/lib/config";
import { AnalysisGenerationError } from "@/lib/anthropic";
import { getLatestTenK, type TenK } from "@/lib/tenk";
import {
  companyProfileSchema,
  SECTION_TITLES,
  type Claim,
  type CompanyProfile,
  type CompanyProfileAi,
  type CompanyProfileSection,
  type VerifiedClaim,
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

  const needle = normalizeForMatch(quote);
  // Check the named section first, then the other: the model occasionally
  // mislabels which item a sentence came from, which is a bookkeeping slip
  // rather than a fabrication, so it shouldn't cost a real quote.
  const ordered =
    claim.source === "mdna"
      ? [sources.mdna, sources.business]
      : [sources.business, sources.mdna];

  return ordered.some((text) => text !== null && normalizeForMatch(text).includes(needle));
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

For "plans", use only intentions management has actually stated — capital allocation commitments, announced investments, named initiatives. Never infer a plan from a trend.`;
}

const TIMEOUT_MS = 180_000;

/**
 * Generate and verify a profile. Returns null when the company has no usable
 * 10-K — a foreign private issuer filing 20-F, or a filing whose sections
 * couldn't be located — which the caller reports rather than papers over.
 */
export async function buildCompanyProfile(
  ticker: string,
  companyName: string
): Promise<CompanyProfile | null> {
  const tenK = await getLatestTenK(ticker);
  if (!tenK) return null;

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
    Object.keys(SECTION_TITLES) as (keyof CompanyProfileAi)[]
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

  return {
    formatVersion: 1,
    ticker,
    companyName,
    generatedAt: new Date().toISOString(),
    model: config.anthropicModel,
    filing: { url: tenK.url, accession: tenK.accession, filedDate: tenK.filedDate },
    opening: openingOf(tenK.business),
    sections,
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
    if (line.length >= 180) return line.length > 1200 ? `${line.slice(0, 1200).trim()}…` : line;
  }
  return null;
}
