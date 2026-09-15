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

export const companyProfileSchema = z.object({
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

/** A claim that survived quote verification, with where to check it. */
export interface VerifiedClaim extends Claim {
  /** Deep link to the filing the quote was found in. */
  sourceUrl: string;
  sourceLabel: string;
}

export interface CompanyProfileSection {
  key: keyof CompanyProfileAi;
  title: string;
  claims: VerifiedClaim[];
}

export interface CompanyProfile {
  formatVersion: 1;
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
  /**
   * How many claims failed quote verification and were discarded. Surfaced so
   * a profile built from a badly-parsed filing is visible rather than silent.
   */
  discardedClaims: number;
}

export const SECTION_TITLES: Record<keyof CompanyProfileAi, string> = {
  whatItIs: "What the business actually is",
  howItMakesMoney: "How it makes money",
  customers: "Who buys it, and why",
  competition: "Competitive position",
  plans: "What management says is next",
};
