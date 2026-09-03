import { z } from "zod";
import { macroSectionSchema, verdictSectionSchema } from "@/types/analysis-v2";
import type { EtfSnapshot } from "@/lib/etf";
import type { RetrievalResult } from "@/lib/websearch";

/**
 * ETF note format.
 *
 * A fund has no revenue, margins, filings, deals or management, so the
 * company sections do not apply. What it has is a price history, a cost, and
 * a basket of holdings. Macro and verdict are reused wholesale — they judge a
 * security, not a business — which keeps the two formats consistent.
 *
 * The model writes interpretation only. Every performance and risk figure is
 * computed from real closes in lib/etf.ts; holdings and costs come from web
 * retrieval with citations.
 */

const dual = z.object({
  analyst: z.string().describe("Dense analyst voice: specific numbers, named comparisons"),
  explain: z.string().describe("Plain-English voice: analogy first, then apply it to this fund"),
});

export const etfCoreSchema = z.object({
  signal: z
    .enum(["BUY", "HOLD", "SELL"])
    .describe("The overall signal the analysis supports for holding this fund"),
  signalReason: z
    .string()
    .describe(
      "One sentence citing the specific figures that justify it — use the computed performance and risk numbers provided, not remembered ones"
    ),
  conviction: z.enum(["low", "medium", "high"]),
  convictionNote: z.string().describe("One sentence on why conviction sits there"),

  overview: z.object({
    whatItTracks: dual.describe(
      "2-3 sentences: what the fund actually holds and what index or theme it follows"
    ),
    suitability: dual.describe(
      "2-3 sentences: the kind of portfolio role this fund plays and who it suits, framed descriptively rather than as personal advice"
    ),
    bullCase: z.array(z.string()).describe("3-4 specific reasons this fund could do well"),
    bearCase: z.array(z.string()).describe("3-4 specific risks, including structural ones"),
  }),

  performanceCommentary: dual.describe(
    "3-4 sentences interpreting the computed return, volatility, drawdown and beta figures provided. Reference the actual numbers. Do not invent additional ones."
  ),
});

export const etfHoldingsSchema = z.object({
  holdings: z.object({
    concentration: dual.describe(
      "2-3 sentences on how concentrated the fund is and what that means for its risk, using the retrieved holdings if provided"
    ),
    keyExposures: z
      .array(
        z.object({
          name: z.string().describe("A sector, theme or single position driving the fund"),
          why: z.string().describe("One sentence on why it matters to returns"),
        })
      )
      .describe("3-4 exposures that actually drive this fund"),
  }),
  costs: dual.describe(
    "2-3 sentences on cost and structure. If no expense ratio was retrieved, say it could not be sourced rather than estimating one."
  ),
});

/** Composed shape of the assembled ETF note (never sent whole to the API). */
export const etfNoteSchema = z.object({
  ...etfCoreSchema.shape,
  ...etfHoldingsSchema.shape,
  ...macroSectionSchema.shape,
  ...verdictSectionSchema.shape,
});

export type EtfNote = z.infer<typeof etfNoteSchema>;

export interface ResearchNoteEtf {
  formatVersion: 3;
  /** Distinguishes a fund note from a company note at render time. */
  securityKind: "fund";
  ticker: string;
  companyName: string;
  generatedAt: string;
  model: string;
  /** Verified: price, 52-week range and metrics computed from real closes. */
  snapshot: EtfSnapshot;
  /** Sourced: expense ratio, AUM, holdings — each with a citation and tier. */
  retrieved?: RetrievalResult | null;
  newsHeadlines: { headline: string; date: string; source: string }[];
  ai: EtfNote;
}
