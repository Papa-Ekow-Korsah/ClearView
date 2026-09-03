import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "@/lib/config";
import { AnalysisGenerationError } from "@/lib/anthropic";
import {
  etfCoreSchema,
  etfHoldingsSchema,
  type EtfNote,
} from "@/types/analysis-etf";
import { macroSectionSchema, verdictSectionSchema } from "@/types/analysis-v2";
import type { EtfSnapshot } from "@/lib/etf";
import { foundFacts, type RetrievalResult } from "@/lib/websearch";
import type { NewsItem } from "@/lib/finnhub";

export interface EtfNoteInput {
  ticker: string;
  name: string;
  snapshot: EtfSnapshot;
  retrieved: RetrievalResult | null;
  news: NewsItem[];
}

function pct(v: number | null, digits = 1): string {
  return v === null ? "n/a" : `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

function buildPrompt(input: EtfNoteInput): string {
  const { ticker, name, snapshot, retrieved, news } = input;
  const p = snapshot.performance;

  const perfLines = p.windows
    .map(
      (w) =>
        `${w.label}: fund ${pct(w.fundPct)}, ${p.benchmark} ${pct(w.benchmarkPct)}, difference ${pct(w.alphaPct)}`
    )
    .join("\n");

  const facts = foundFacts(retrieved);
  const factLines = facts.length
    ? facts
        .map((f) => `${f.field}: ${f.value}  [source: ${f.domain}, credibility: ${f.tier}]`)
        .join("\n")
    : "none could be sourced";

  const headlines = news
    .slice(0, 10)
    .map(
      (n) =>
        `- [${new Date(n.datetime * 1000).toISOString().slice(0, 10)}] ${n.headline}`
    )
    .join("\n");

  return `You are writing a research note on ${name} (${ticker}), an exchange-traded fund, for a thesis-driven retail investor. A fund is not a company: it has no revenue, margins, filings or management to assess. Judge it on what it holds, what it costs, and how it has behaved.

Write every narrative field twice: "analyst" voice (dense, specific, uses the numbers) and "explain" voice (plain English, one analogy, then applied to this fund).

COMPUTED PERFORMANCE AND RISK — these are calculated from ${p.observations} daily closes between ${p.from ?? "n/a"} and ${p.to ?? "n/a"}, and are displayed to the user beside your commentary. Use these exact figures; do not adjust them or introduce others:
${perfLines}
Annualised volatility: ${pct(p.annualisedVolPct)}
Maximum drawdown over the period: ${pct(p.maxDrawdownPct)}
Beta vs ${p.benchmark}: ${p.betaVsBenchmark === null ? "n/a" : p.betaVsBenchmark.toFixed(2)}
Price: ${snapshot.price ?? "n/a"} ${snapshot.currency ?? ""} (day ${pct(snapshot.dayChangePct, 2)})
52-week range: ${snapshot.week52Low ?? "n/a"} – ${snapshot.week52High ?? "n/a"}
${snapshot.firstTradeDate ? `Trading since: ${snapshot.firstTradeDate}` : ""}

A window showing n/a means the fund's price history does not cover it. Say so plainly rather than filling the gap.

RETRIEVED FUND FACTS (each read from a live page; the app shows the source link and credibility tier beside them):
${factLines}

If a fact above is absent, state that it could not be sourced rather than recalling a figure. A fabricated expense ratio or holding is the worst error this note can contain.

Recent news:
${headlines || "none available"}

Judge the fund on evidence: what it holds, its cost, how it has actually performed against ${p.benchmark}, and how much risk it took to get there. Frame suitability descriptively — the portfolio role it plays — never as personal advice. Verdict language: "the analysis suggests", never "you should". Plain prose only inside fields; no JSON syntax or markup.`;
}

const coreVerdictSchema = z.object({
  ...etfCoreSchema.shape,
  ...verdictSectionSchema.shape,
});

const SECTION_PROMPTS = {
  coreVerdict:
    "Produce the OVERVIEW and VERDICT sections: signal with a data-packed one-sentence reason, conviction, what the fund tracks, who it suits, bull and bear cases, commentary on the computed performance and risk figures, then the verdict synthesis, a six-dimension scorecard, catalysts and the research recommendation.",
  holdings:
    "Produce the HOLDINGS and COSTS sections: how concentrated the fund is and what that means for risk, three to four exposures that actually drive returns, and commentary on cost and structure.",
  macro:
    "Produce the MACRO section: the net macro verdict for this fund, a net-impact meter position, and three to four macro factors, each naming the specific channel through which it reaches this fund's holdings.",
} as const;

const SECTION_TIMEOUT_MS = 100_000;
const MAX_SECTION_ATTEMPTS = 2;

class SectionRetryable extends Error {}

async function generateSectionOnce<S extends z.ZodType>(
  client: Anthropic,
  basePrompt: string,
  sectionPrompt: string,
  schema: S
): Promise<z.infer<S>> {
  let response;
  try {
    const stream = client.messages.stream(
      {
        model: config.anthropicModel,
        max_tokens: 20000,
        messages: [
          { role: "user", content: `${basePrompt}\n\nYOUR TASK:\n${sectionPrompt}` },
        ],
        output_config: { format: zodOutputFormat(schema) },
      },
      { timeout: SECTION_TIMEOUT_MS }
    );
    response = await stream.finalMessage();
  } catch (err) {
    if (err instanceof Anthropic.APIConnectionTimeoutError) {
      throw new SectionRetryable("section timed out");
    }
    if (err instanceof Anthropic.APIError) throw err;
    throw new SectionRetryable(err instanceof Error ? err.message : "parse failure");
  }

  if (response.stop_reason === "refusal") {
    throw new AnalysisGenerationError("The model declined to generate this analysis.");
  }
  if (response.stop_reason === "max_tokens") {
    throw new SectionRetryable("truncated at max_tokens");
  }
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") throw new SectionRetryable("empty response");

  let json: unknown;
  try {
    json = JSON.parse(text.text);
  } catch {
    throw new SectionRetryable("malformed json");
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) throw new SectionRetryable("schema mismatch");
  return parsed.data;
}

async function generateSection<S extends z.ZodType>(
  client: Anthropic,
  basePrompt: string,
  sectionPrompt: string,
  schema: S
): Promise<z.infer<S>> {
  for (let attempt = 1; attempt <= MAX_SECTION_ATTEMPTS; attempt++) {
    try {
      return await generateSectionOnce(client, basePrompt, sectionPrompt, schema);
    } catch (err) {
      if (err instanceof SectionRetryable && attempt < MAX_SECTION_ATTEMPTS) continue;
      if (err instanceof SectionRetryable) {
        throw new AnalysisGenerationError(
          "A section of the analysis kept coming back incomplete. Please try again."
        );
      }
      throw err;
    }
  }
  throw new AnalysisGenerationError("Analysis failed. Please try again.");
}

/** Generate the fund note as three parallel structured calls. */
export async function generateEtfNote(input: EtfNoteInput): Promise<EtfNote> {
  // maxRetries 0: the SDK otherwise retries timeouts and multiplies them.
  const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
  const base = buildPrompt(input);

  try {
    const [coreVerdict, holdings, macro] = await Promise.all([
      generateSection(client, base, SECTION_PROMPTS.coreVerdict, coreVerdictSchema),
      generateSection(client, base, SECTION_PROMPTS.holdings, etfHoldingsSchema),
      generateSection(client, base, SECTION_PROMPTS.macro, macroSectionSchema),
    ]);
    return { ...coreVerdict, ...holdings, ...macro };
  } catch (err) {
    if (err instanceof AnalysisGenerationError) throw err;
    if (err instanceof Anthropic.AuthenticationError) {
      throw new AnalysisGenerationError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.");
    }
    if (err instanceof Anthropic.RateLimitError) {
      throw new AnalysisGenerationError("Anthropic rate limit reached. Wait a minute and try again.");
    }
    if (err instanceof Anthropic.APIError) {
      if (/credit balance is too low|billing/i.test(err.message)) {
        throw new AnalysisGenerationError(
          "Analysis is temporarily unavailable. Please try again later."
        );
      }
      throw new AnalysisGenerationError(`Anthropic API error (HTTP ${err.status}): ${err.message}`);
    }
    throw err;
  }
}
