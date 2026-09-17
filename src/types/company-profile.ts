import { z } from "zod";

/**
 * The company profile: what the business is, how it earns, who buys it, why
 * they stay, and what management says is next.
 *
 * Every assertion carries a verbatim quote from the 10-K. That isn't a
 * stylistic choice — it's the enforcement mechanism. After generation each
 * quote is searched for in the filing text, and any claim whose quote isn't
 * found is discarded before the profile is ever stored. A claim the model
 * invented has no supporting sentence in the source, so it cannot survive.
 */

export const claimSchema = z.object({
  point: z
    .string()
    .describe(
      "One specific, concrete statement about this business in your own words. No hedging, no generic industry description."
    ),
  quote: z
    .string()
    .describe(
      "The sentence from the filing that supports the point, copied EXACTLY character for character. This is checked against the source text; a paraphrase will be discarded."
    ),
  source: z
    .enum(["business", "mdna"])
    .describe("Which section the quote came from: Item 1 (business) or Item 7 (mdna)"),
});

export type Claim = z.infer<typeof claimSchema>;

/**
 * One reportable segment's revenue, for the revenue-mix chart. The figure is
 * copied exactly as the filing states it and must appear inside the quote,
 * which must itself appear in the filing — so a charted number can't be
 * invented or misread without failing verification.
 */
export const segmentSchema = z.object({
  name: z.string().describe("Reportable segment name exactly as the filing uses it"),
  amountAsStated: z
    .string()
    .describe('The revenue figure copied exactly as written in the quote, e.g. "$193,479" or "$11.8 billion"'),
  amount: z
    .number()
    .describe("The numeric value of amountAsStated with no rescaling, e.g. 193479 or 11.8"),
  period: z.string().describe('The fiscal period the figure covers, e.g. "Fiscal 2026"'),
  quote: z
    .string()
    .describe("The sentence or table row from the filing containing this figure, copied exactly"),
  source: z.enum(["business", "mdna"]),
});

/** One step in how value moves from what the company makes to who pays for it. */
export const valueStepSchema = z.object({
  stage: z.string().describe("2-4 word label for this step"),
  detail: z.string().describe("One plain sentence on what happens at this step"),
  quote: z.string().describe("The filing sentence supporting this step, copied exactly"),
  source: z.enum(["business", "mdna"]),
});

export type SegmentFigure = z.infer<typeof segmentSchema>;
export type ValueStep = z.infer<typeof valueStepSchema>;

export const companyProfileSchema = z.object({
  segments: z
    .array(segmentSchema)
    .describe(
      "Revenue for each reportable segment for the most recent full fiscal year, only where the filing states the figure. Same period for all. Empty if not stated."
    ),
  valueChain: z
    .array(valueStepSchema)
    .describe(
      "3-5 steps, in order, tracing how the company creates value and gets paid: what it makes or does, how it reaches customers, who pays and for what"
    ),
  whatItIs: z
    .array(claimSchema)
    .describe("4-6 claims: what this company actually does day to day — operations, segments, scale"),
  howItMakesMoney: z
    .array(claimSchema)
    .describe("4-6 claims: the revenue model — what is sold, to whom, on what terms, which segments earn what"),
  customers: z
    .array(claimSchema)
    .describe("3-5 claims: who the customers are and what they are buying it for — the value proposition"),
  competition: z
    .array(claimSchema)
    .describe("3-5 claims: the competitive position — rivals named, and what keeps customers from leaving"),
  plans: z
    .array(claimSchema)
    .describe("3-5 claims: what management has stated it will pursue next. Stated intentions only, never inference"),
});

export type CompanyProfileAi = z.infer<typeof companyProfileSchema>;

/** The five prose sections — everything in the schema except the diagram data. */
export type SectionKey = Exclude<keyof CompanyProfileAi, "segments" | "valueChain">;

export const PROFILE_FORMAT_VERSION = 2;

/** A claim that survived quote verification, with where to check it. */
export interface VerifiedClaim extends Claim {
  /** Deep link to the filing the quote was found in. */
  sourceUrl: string;
  sourceLabel: string;
}

export interface CompanyProfileSection {
  key: SectionKey;
  title: string;
  claims: VerifiedClaim[];
}

/** A segment figure that passed verification. */
export interface VerifiedSegment extends SegmentFigure {
  sourceUrl: string;
}

/** A value-chain step that passed verification. */
export interface VerifiedValueStep extends ValueStep {
  sourceUrl: string;
}

export interface CompanyProfile {
  /**
   * 1 = prose sections only. 2 adds the verified segment and value-chain data
   * behind the diagrams. A v1 profile still renders, without them.
   */
  formatVersion: 1 | 2;
  ticker: string;
  companyName: string;
  generatedAt: string;
  model: string;
  /** The 10-K this was built from — the cache key, since it changes annually. */
  filing: {
    url: string;
    accession: string;
    filedDate: string;
  };
  /**
   * The filing's own opening lines, verbatim. Not model output at all — the
   * company's own description of itself, which is both the most accurate
   * possible summary and impossible to fabricate.
   */
  opening: string | null;
  sections: CompanyProfileSection[];
  /** Revenue by segment, only figures found verbatim in the filing. Absent on v1. */
  segments?: VerifiedSegment[];
  /** How value flows through the business, each step quote-verified. Absent on v1. */
  valueChain?: VerifiedValueStep[];
  /**
   * How many claims failed quote verification and were discarded. Surfaced so
   * a profile built from a badly-parsed filing is visible rather than silent.
   */
  discardedClaims: number;
}

export const SECTION_TITLES: Record<SectionKey, string> = {
  whatItIs: "What the business actually is",
  howItMakesMoney: "How it makes money",
  customers: "Who buys it, and why",
  competition: "Competitive position",
  plans: "What management says is next",
};
