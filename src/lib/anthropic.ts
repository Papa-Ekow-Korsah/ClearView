import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { config } from "@/lib/config";
import { aiNoteSchema, type AiNote, type PeerRow, type Snapshot } from "@/types/analysis";
import type { NewsItem } from "@/lib/finnhub";

class AnalysisGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnalysisGenerationError";
  }
}

export { AnalysisGenerationError };

export interface NoteInput {
  ticker: string;
  companyName: string;
  industry: string | null;
  snapshot: Snapshot;
  subjectMetrics: Record<string, number | string | null>;
  peers: PeerRow[];
  news: NewsItem[];
}

function fmtNum(v: number | null, suffix = ""): string {
  return v === null ? "n/a" : `${v.toFixed(1)}${suffix}`;
}

function buildPrompt(input: NoteInput): string {
  const { ticker, companyName, industry, snapshot, peers, news } = input;

  const peerTable = peers
    .map(
      (p) =>
        `${p.ticker}${p.isSubject ? " (subject)" : ""} | ${p.name} | mktCap $${fmtNum(
          p.marketCap
        )}M | revGrowth ${fmtNum(p.revenueGrowthTTM, "%")} | grossMargin ${fmtNum(
          p.grossMarginTTM,
          "%"
        )} | opMargin ${fmtNum(p.operatingMarginTTM, "%")} | P/E ${fmtNum(
          p.peTTM,
          "x"
        )} | EV/EBITDA ${fmtNum(p.evEbitdaTTM, "x")} | debt/equity ${fmtNum(
          p.debtToEquity,
          "x"
        )}`
    )
    .join("\n");

  const headlines = news
    .slice(0, 12)
    .map(
      (n) =>
        `- [${new Date(n.datetime * 1000).toISOString().slice(0, 10)}] ${n.headline} (${n.source})`
    )
    .join("\n");

  const keyMetrics = Object.entries(input.subjectMetrics)
    .filter(([k]) =>
      [
        "peTTM",
        "revenueGrowthTTMYoy",
        "revenueGrowth3Y",
        "grossMarginTTM",
        "operatingMarginTTM",
        "netProfitMarginTTM",
        "roeTTM",
        "totalDebt/totalEquityQuarterly",
        "currentRatioQuarterly",
        "epsGrowthTTMYoy",
        "52WeekHigh",
        "52WeekLow",
        "beta",
      ].includes(k)
    )
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");

  return `You are writing a research note for a thesis-driven retail investor focused on asymmetric returns, small/mid-cap opportunities, and identifiable catalysts. Write with conviction where the data supports it and honesty where it doesn't. No hedging boilerplate, no generic disclaimers — those live elsewhere in the app.

Company: ${companyName} (${ticker})
Industry: ${industry ?? "unknown"}
Price: ${snapshot.price ?? "n/a"} ${snapshot.currency ?? ""} (day change ${fmtNum(snapshot.dayChangePct, "%")})
Market cap: $${fmtNum(snapshot.marketCap)}M
52-week range: ${snapshot.week52Low ?? "n/a"} – ${snapshot.week52High ?? "n/a"}

Key metrics (Finnhub, TTM unless noted):
${keyMetrics || "n/a"}

Peer comparison (all figures from Finnhub — this exact table is shown to the user next to your commentary):
${peerTable}

Recent news headlines (last 30 days):
${headlines || "none available"}

Ground every claim in the data above or in well-known public facts about the company. Where the data is missing or ambiguous, say so rather than inventing figures. Time-bound catalysts as specifically as the information allows. Write plain prose only — no JSON syntax, braces, or markup inside any field.`;
}

/**
 * Constrained decoding guarantees valid JSON, but the model can still leak
 * JSON-ish noise *inside* a string (observed: prose ending in `"} }} }}}`).
 * Strip a trailing run of quotes/braces/whitespace iff it contains a brace.
 */
export function stripJsonNoise(s: string): string {
  const m = s.match(/[\s"'‘’“”{}[\]]+$/);
  if (m && /[{}]/.test(m[0])) return s.slice(0, -m[0].length).trimEnd();
  return s;
}

function sanitizeNote(note: AiNote): AiNote {
  return {
    thesis: stripJsonNoise(note.thesis),
    peerCommentary: stripJsonNoise(note.peerCommentary),
    catalysts: note.catalysts.map((c) => ({
      title: stripJsonNoise(c.title),
      timeframe: stripJsonNoise(c.timeframe),
      description: stripJsonNoise(c.description),
    })),
    risks: note.risks.map((r) => ({
      title: stripJsonNoise(r.title),
      description: stripJsonNoise(r.description),
    })),
  };
}

/** Generate the narrative sections of a research note via structured output. */
export async function generateAiNote(input: NoteInput): Promise<AiNote> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    const response = await client.messages.parse({
      model: config.anthropicModel,
      max_tokens: 4096,
      messages: [{ role: "user", content: buildPrompt(input) }],
      output_config: {
        format: zodOutputFormat(aiNoteSchema),
      },
    });

    if (response.stop_reason === "refusal") {
      throw new AnalysisGenerationError(
        "The model declined to generate this analysis."
      );
    }
    if (response.stop_reason === "max_tokens") {
      throw new AnalysisGenerationError(
        "The analysis was cut off mid-generation (token limit). Try again."
      );
    }
    if (!response.parsed_output) {
      throw new AnalysisGenerationError(
        "The model response did not match the expected format. Try again."
      );
    }
    return sanitizeNote(response.parsed_output);
  } catch (err) {
    if (err instanceof AnalysisGenerationError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AnalysisGenerationError(
        "Anthropic rejected the API key. Check ANTHROPIC_API_KEY in your environment."
      );
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AnalysisGenerationError(
        "Anthropic rate limit reached. Wait a minute and try again."
      );
    }
    if (err instanceof Anthropic.NotFoundError) {
      throw new AnalysisGenerationError(
        `Model "${config.anthropicModel}" was not found. Check ANTHROPIC_MODEL in your environment.`
      );
    }
    if (err instanceof Anthropic.APIError) {
      throw new AnalysisGenerationError(
        `Anthropic API error (HTTP ${err.status}): ${err.message}`
      );
    }
    throw err;
  }
}
