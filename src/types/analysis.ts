import { z } from "zod";

/**
 * The AI-generated portion of a research note. Numbers in the peer table
 * come from Finnhub directly — Claude only writes narrative, so it can't
 * hallucinate financials.
 */
export const aiNoteSchema = z.object({
  thesis: z
    .string()
    .describe(
      "The core bull case in 3-5 sentences: what the market under-appreciates and why the setup may be asymmetric."
    ),
  catalysts: z
    .array(
      z.object({
        title: z.string().describe("Short name of the catalyst"),
        timeframe: z
          .string()
          .describe(
            "When it lands, as specific as the data allows, e.g. 'Q3 2026 earnings (est. late Oct)' or 'H2 2026'"
          ),
        description: z
          .string()
          .describe("2-3 sentences on what it is and why it moves the stock"),
      })
    )
    .describe("3-5 specific, time-bounded upcoming events"),
  risks: z
    .array(
      z.object({
        title: z.string().describe("Short name of the risk"),
        description: z
          .string()
          .describe(
            "2-3 sentences on the honest bear case — execution, competition, macro sensitivity, balance sheet, or valuation. Not generic disclaimers."
          ),
      })
    )
    .describe("3-5 real risks"),
  peerCommentary: z
    .string()
    .describe(
      "2-3 sentences on how the company stacks up against the peers in the provided comparison table"
    ),
});

export type AiNote = z.infer<typeof aiNoteSchema>;

/** One row of the peer comparison table — built from Finnhub metrics, not AI. */
export interface PeerRow {
  ticker: string;
  name: string;
  marketCap: number | null; // millions USD
  revenueGrowthTTM: number | null; // %
  grossMarginTTM: number | null; // %
  operatingMarginTTM: number | null; // %
  peTTM: number | null;
  evEbitdaTTM: number | null;
  netDebtToEbitda: number | null;
  isSubject: boolean; // true for the analyzed company's own row
}

/** Factual company snapshot shown in the analysis header. */
export interface Snapshot {
  price: number | null;
  dayChangePct: number | null;
  marketCap: number | null; // millions USD
  week52High: number | null;
  week52Low: number | null;
  exchange: string | null;
  industry: string | null;
  currency: string | null;
}

/** The full saved research note — everything needed to re-render without re-fetching. */
export interface ResearchNote {
  ticker: string;
  companyName: string;
  generatedAt: string; // ISO
  model: string;
  snapshot: Snapshot;
  ai: AiNote;
  peers: PeerRow[];
  newsHeadlines: { headline: string; date: string; source: string }[];
}
