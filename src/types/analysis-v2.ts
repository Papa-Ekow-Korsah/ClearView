import { z } from "zod";
import type { PeerRow, Snapshot } from "@/types/analysis";
import type { SecFinancials } from "@/lib/sec";

/**
 * V2 rich note format — the six-tab deep dive carried over from ClearView v1
 * (Overview / Earnings / Ratios / Deals & Contracts / Macro / Verdict).
 *
 * Provenance rules:
 * - VERIFIED data (Finnhub): snapshot, peer table, ratio VALUES, EPS
 *   actual-vs-estimate history. Server-computed, AI never touches them.
 * - AI-SOURCED data (model knowledge + news): segment revenue, guidance,
 *   balance sheet figures, deals, macro readings. Rendered with an
 *   "AI-sourced" marker in the UI.
 */

/** Every narrative field comes in two voices, toggled in the UI. */
const dual = z.object({
  analyst: z.string().describe("Dense analyst voice: specific numbers, named peers, no hand-holding"),
  explain: z.string().describe("Plain-English voice: analogy first, then apply it to this company"),
});
export type DualText = z.infer<typeof dual>;

/** Fixed set of ratios the server computes from Finnhub metric=all. */
export const RATIO_KEYS = [
  "peTTM",
  "evEbitdaTTM",
  "psTTM",
  "roeTTM",
  "debtToEquity",
  "currentRatio",
] as const;
export type RatioKey = (typeof RATIO_KEYS)[number];

export const RATIO_LABELS: Record<RatioKey, string> = {
  peTTM: "P/E (trailing)",
  evEbitdaTTM: "EV/EBITDA",
  psTTM: "P/S (trailing)",
  roeTTM: "Return on equity",
  debtToEquity: "Debt / equity",
  currentRatio: "Current ratio",
};

const verdictTone = z.enum(["ok", "watch", "warn", "neutral"]);
const impactDir = z.enum(["tailwind", "headwind", "mixed", "neutral"]);

/**
 * The full note is generated as FIVE separate structured-output calls (one
 * per section schema below) run in parallel, then assembled — a single
 * combined schema exceeds the API's compiled-grammar size limit.
 */
export const coreSectionSchema = z.object({
  signal: z
    .enum(["BUY", "HOLD", "SELL"])
    .describe("The overall signal the analysis supports"),
  signalReason: z
    .string()
    .describe("One sentence packed with the specific data points that justify the signal"),
  conviction: z.enum(["low", "medium", "high"]),
  convictionNote: z.string().describe("One sentence on why conviction is at this level"),

  overview: z.object({
    bullCase: z.array(z.string()).describe("4 specific bull points"),
    bearCase: z.array(z.string()).describe("4 specific bear points"),
    analystConsensus: z
      .string()
      .describe('Street consensus if known, e.g. "Buy (avg target $240)" — say "Not available" if unsure'),
    recentMoves: z
      .array(z.string())
      .describe("2-3 recent analyst rating/target moves if known from news; empty array if none"),
  }),
});

export const earningsSectionSchema = z.object({
  earnings: z.object({
    period: z.string().describe('Latest reported quarter, e.g. "Q1 FY2027"'),
    reportDate: z.string().describe("When it was reported"),
    beatBanner: dual.describe("2-3 sentence quarter summary for the banner"),
    revenue: z.object({
      value: z.string().describe('e.g. "$81.6B"'),
      estimate: z.string(),
      beat: z.string().describe('e.g. "+$2.8B"'),
      yoy: z.string().describe('e.g. "+85%"'),
    }),
    segments: z
      .array(
        z.object({
          name: z.string(),
          revenue: z.string(),
          growth: z.string().describe('YoY, e.g. "+92%"'),
          barPct: z.number().describe("Relative bar width 5-100, largest segment = 100"),
        })
      )
      .describe("3-4 revenue segments"),
    margins: z
      .array(
        z.object({
          name: z.string(),
          value: z.string(),
          barPct: z.number(),
          yoyNote: z.string().describe("Short change-vs-year-ago note"),
          tone: verdictTone,
        })
      )
      .describe("3-4 margin rows"),
    balanceSheet: z.object({
      cash: z.string(),
      totalAssets: z.string(),
      totalLiabilities: z.string(),
      equity: z.string(),
      longTermDebt: z.string(),
      netDebt: z.string().describe('Negative means net cash, e.g. "-$25B (net cash)"'),
      note: dual.describe("2 sentences on overall balance sheet health"),
    }),
    cashFlow: z
      .array(
        z.object({
          label: z.string(),
          value: z.string(),
          note: dual,
        })
      )
      .describe("2-3 rows: operating CF, free CF, buybacks/dividends"),
    guidance: z.object({
      quarter: z.string(),
      revenueRange: z.string(),
      eps: z.string(),
      grossMargin: z.string(),
      nextReportDate: z.string(),
      vsConsensus: z.string().describe('e.g. "above consensus"'),
      narrative: dual.describe(
        "3-4 sentences: management confidence, vs consensus, the assumption that could cause a miss"
      ),
    }),
    summary: dual.describe("4-5 sentence full earnings assessment"),
  }),
});

export const ratiosSectionSchema = z.object({
  ratios: z
    .array(
      z.object({
        key: z.enum(RATIO_KEYS),
        verdict: verdictTone,
        verdictLabel: z.string().describe('Short tag, e.g. "Healthy", "Caution", "Watch"'),
        barPct: z.number().describe("Position 0-100 on the cheap→expensive (or weak→strong) range bar"),
        barLeft: z.string().describe('Left bar label, e.g. "Cheap (10x)"'),
        barMid: z.string(),
        barRight: z.string(),
        peerNote: dual.describe("One-line peer context under the ratio name"),
        explain: dual.describe(
          "3 sentences on what THIS value means for THIS company NOW vs named peers — not a textbook definition"
        ),
      })
    )
    .describe("Exactly one entry per provided ratio key, same order"),
});

export const dealsSectionSchema = z.object({
  deals: z
    .array(
      z.object({
        title: z.string().describe('e.g. "Partner — deal description"'),
        partnerCode: z.string().describe("2-4 letter logo abbreviation"),
        status: z.enum(["confirmed", "unconfirmed", "risk"]),
        date: z.string().describe('e.g. "Nov 2025"'),
        subtitle: dual.describe("One-line source/status detail"),
        body: dual.describe("3 sentences: the deal, financial impact, strategic significance"),
        chips: z.array(
          z.object({
            label: z.string(),
            type: z.enum(["revenue", "strategic", "risk", "neutral"]),
          })
        ),
      })
    )
    .describe("3-4 deals/contracts from the last 12 months, grounded in the provided news where possible"),

  management: z
    .array(
      z.object({
        initials: z.string(),
        name: z.string().describe('"Name — Role"'),
        role: z.string().describe('Tenure, e.g. "CEO since 1993"'),
        signal: z.enum(["positive", "watch", "concern"]),
        tagLabel: z.string(),
        body: dual.describe("2-3 sentences: track record, execution, key risk"),
      })
    )
    .describe("2 key executives"),
});

export const macroSectionSchema = z.object({
  macro: z.object({
    summary: dual.describe("2 sentences: net macro verdict for this specific company"),
    netImpact: z.object({
      label: z.string().describe('e.g. "Mixed — slight tailwind"'),
      direction: impactDir,
      barPct: z.number().describe("0 = strong headwind, 50 = neutral, 100 = strong tailwind"),
    }),
    factors: z
      .array(
        z.object({
          name: z.string(),
          reading: z.string().describe("Current level/state of this factor"),
          impact: impactDir,
          impactLabel: z.string(),
          arrow: z.enum(["up", "down", "flat"]),
          arrowLabel: z.string().describe("One-line conclusion"),
          body: dual.describe(
            "3 sentences on the SPECIFIC transmission channel to THIS company, with numbers where possible"
          ),
        })
      )
      .describe("3-4 macro factors"),
  }),
});

export const verdictSectionSchema = z.object({
  verdict: z.object({
    text: dual.describe(
      '4 sentences: synthesis, why this signal, the key binary, timing — "the analysis suggests", never "you should"'
    ),
    scorecard: z
      .array(
        z.object({
          name: z.string().describe('e.g. "Valuation", "Growth", "Moat", "Balance sheet", "Momentum", "Risk"'),
          rating: z.string().describe('Short, e.g. "Strong", "Neutral", "Stretched"'),
          tone: verdictTone,
          desc: dual.describe("2 sentences"),
        })
      )
      .describe("6 scorecard dimensions"),
    catalysts: z
      .array(
        z.object({
          date: z.string().describe('e.g. "Aug 26" or "H2 2026"'),
          title: z.string(),
          pill: z.enum(["bull", "watch", "neutral"]),
          pillLabel: z.string().describe('e.g. "Primary catalyst"'),
          desc: dual.describe("2 sentences"),
        })
      )
      .describe("2-3 upcoming catalysts, nearest first"),
    recommendation: z.object({
      text: dual.describe("3 sentences: the research position"),
      chips: z.array(
        z.object({
          label: z.string(),
          tone: z.enum(["buy", "hold", "watch", "caution"]),
        })
      ),
    }),
  }),
});

/** Composed shape of the fully-assembled note (never sent to the API whole). */
export const aiNoteV2Schema = z.object({
  ...coreSectionSchema.shape,
  ...earningsSectionSchema.shape,
  ...ratiosSectionSchema.shape,
  ...dealsSectionSchema.shape,
  ...macroSectionSchema.shape,
  ...verdictSectionSchema.shape,
});

export type AiNoteV2 = z.infer<typeof aiNoteV2Schema>;

/** Server-computed, Finnhub-verified ratio row shown alongside AI interpretation. */
export interface RatioValue {
  key: RatioKey;
  label: string;
  value: number | null;
  /** Peer values for the same ratio, for the peer-context line. */
  peerValues: { ticker: string; value: number | null }[];
}

/** Verified EPS surprise history from Finnhub /stock/earnings. */
export interface EpsSurprise {
  period: string;
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;
}

export interface ResearchNoteV2 {
  formatVersion: 2;
  ticker: string;
  companyName: string;
  generatedAt: string;
  model: string;
  snapshot: Snapshot;
  peers: PeerRow[];
  ratioValues: RatioValue[];
  epsSurprises: EpsSurprise[];
  /** As-reported SEC filing figures; null when unavailable (e.g. non-US filers). */
  secFinancials?: SecFinancials | null;
  newsHeadlines: { headline: string; date: string; source: string }[];
  ai: AiNoteV2;
}
