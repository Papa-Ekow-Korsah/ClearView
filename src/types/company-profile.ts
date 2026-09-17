/**
 * The company profile: a long-form read on what the business is, how it
 * earns, who buys from it, who it competes with, how it has been performing
 * and what management says is next.
 *
 * Every paragraph is written from filed documents — the 10-K, the latest
 * 10-Q, and recent earnings releases — and carries the passages it was
 * written from. Before a profile is stored, each passage is searched for in
 * its document, and every figure in the paragraph must appear in one of its
 * verified passages. A paragraph that fails either check is discarded, so
 * nothing the model recalled or computed on its own reaches the reader.
 *
 * The model-facing schema is built at generation time (its source ids are an
 * enum of the documents actually retrieved), so this file holds the stored
 * shape and the shared vocabulary.
 */

export const PROFILE_FORMAT_VERSION = 3;

export type SourceKind = "10-K" | "10-Q" | "8-K";

/** One document a profile was built from. */
export interface SourceDocMeta {
  /** Stable within a profile, e.g. "10k-business", "release1". */
  id: string;
  kind: SourceKind;
  /** Human-readable, e.g. "Form 10-K filed 2026-07-29 — Item 1, Business". */
  label: string;
  filedDate: string;
  url: string;
}

export type SectionKey =
  | "overview"
  | "products"
  | "model"
  | "customers"
  | "competition"
  | "operations"
  | "recent"
  | "strategy"
  | "risks";

export const SECTION_ORDER: SectionKey[] = [
  "overview",
  "products",
  "model",
  "customers",
  "competition",
  "operations",
  "recent",
  "strategy",
  "risks",
];

export const SECTION_TITLES: Record<SectionKey, string> = {
  overview: "The company in brief",
  products: "Products and services",
  model: "How it makes money",
  customers: "Customers, and why they buy",
  competition: "Competition and advantages",
  operations: "How it operates",
  recent: "Recent performance",
  strategy: "Strategy and what's next",
  risks: "Risks management highlights",
};

/** A passage a paragraph was written from, verified to exist in its document. */
export interface Evidence {
  quote: string;
  sourceId: string;
}

export interface ProfileParagraph {
  text: string;
  evidence: Evidence[];
}

/** A run of paragraphs, optionally under a subheading (a product line, a risk). */
export interface ProfileBlock {
  heading: string | null;
  paragraphs: ProfileParagraph[];
}

export interface ProfileSection {
  key: SectionKey;
  title: string;
  blocks: ProfileBlock[];
}

/** A segment revenue figure that passed verification, for the revenue-mix chart. */
export interface VerifiedSegment {
  name: string;
  amountAsStated: string;
  amount: number;
  period: string;
  quote: string;
  sourceId: string;
}

/** One step in how value moves from what the company makes to who pays for it. */
export interface VerifiedValueStep {
  stage: string;
  detail: string;
  quote: string;
  sourceId: string;
}

export interface CompanyProfile {
  /**
   * 1-2: 10-K only, short claims. 3: multi-document long-form prose. Older
   * profiles are rebuilt whenever SEC is reachable.
   */
  formatVersion: 1 | 2 | 3;
  ticker: string;
  companyName: string;
  generatedAt: string;
  model: string;
  /** The 10-K — kept because every profile is anchored on one. */
  filing: {
    url: string;
    accession: string;
    filedDate: string;
  };
  /** The documents this profile drew on, in the order they're cited. */
  sources: SourceDocMeta[];
  /** Identifies the exact document set; the cache is current while it matches. */
  sourceKey: string;
  /** The 10-K's own opening paragraph, verbatim — no model involvement. */
  opening: string | null;
  sections: ProfileSection[];
  segments: VerifiedSegment[];
  valueChain: VerifiedValueStep[];
  /** Paragraphs, steps and figures dropped by verification. */
  discarded: number;
}
