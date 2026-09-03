import Anthropic from "@anthropic-ai/sdk";
import { config } from "@/lib/config";
import {
  assessSource,
  blockedDomains,
  isBlocked,
  type SourceTier,
} from "@/lib/source-credibility";

/**
 * Retrieval for facts that exist publicly but have no affordable feed:
 * revenue consensus, analyst ratings and targets, and (as a fallback where
 * direct EDGAR access is blocked) management guidance.
 *
 * Deliberately narrow. The original ClearView searched for everything and
 * ended up inventing whole balance sheets; the lesson is that search should
 * fill specific gaps, never replace verified feeds. Anything a data source
 * already provides is not asked for here.
 *
 * Every finding must carry a source URL or be reported as not found. Sources
 * are then tiered so the UI can flag weak ones rather than presenting all
 * citations as equally trustworthy.
 */

export type RetrievedField =
  | "REVENUE_CONSENSUS"
  | "ANALYST_RATING"
  | "PRICE_TARGET"
  | "RECENT_MOVES"
  | "GUIDANCE"
  // Fund fields. Finnhub paywalls all of these, so retrieval with a citation
  // is the only honest route to them.
  | "EXPENSE_RATIO"
  | "FUND_AUM"
  | "TOP_HOLDINGS"
  | "INDEX_TRACKED";

export interface RetrievedFact {
  field: RetrievedField;
  value: string;
  url: string | null;
  domain: string | null;
  tier: SourceTier | null;
  /** Why the tier was assigned, surfaced on hover in the UI. */
  note: string | null;
}

export interface RetrievalResult {
  facts: RetrievedFact[];
  /** Everything the search actually consulted, for transparency. */
  consulted: { url: string; domain: string; tier: SourceTier }[];
  searchedAt: string;
}

const COMPANY_FIELDS: RetrievedField[] = [
  "REVENUE_CONSENSUS",
  "ANALYST_RATING",
  "PRICE_TARGET",
  "RECENT_MOVES",
  "GUIDANCE",
];

const FUND_FIELDS: RetrievedField[] = [
  "EXPENSE_RATIO",
  "FUND_AUM",
  "TOP_HOLDINGS",
  "INDEX_TRACKED",
];

/** Every field, for parsing; callers choose which set to retrieve. */
const FIELDS: RetrievedField[] = [...COMPANY_FIELDS, ...FUND_FIELDS];

/**
 * One question per field, asked in parallel.
 *
 * A single call covering all five fields searched sequentially and ran past
 * five minutes, so it never finished inside any sane budget. Split into
 * separate calls, each needing a search or two, the whole set completes in
 * roughly the time of the slowest — and a field that fails or is genuinely
 * unreported no longer takes the others down with it.
 */
const FIELD_QUESTIONS: Record<RetrievedField, string> = {
  REVENUE_CONSENSUS:
    "the Wall Street consensus revenue estimate for its most recently reported quarter (what analysts expected, not what the company actually reported)",
  ANALYST_RATING:
    'the current consensus analyst rating (for example "Buy", "Hold", or a breakdown such as 24 buy / 3 hold)',
  PRICE_TARGET: "the current average analyst price target",
  RECENT_MOVES:
    "up to two notable analyst rating or price-target changes in the last 30 days, separated by semicolons",
  GUIDANCE:
    "management's own revenue or earnings guidance for the current or next quarter, as reported",
  EXPENSE_RATIO: "the fund's net expense ratio (annual management fee)",
  FUND_AUM: "the fund's total assets under management",
  TOP_HOLDINGS:
    "its five largest holdings with their approximate portfolio weights, comma-separated",
  INDEX_TRACKED:
    "the index or benchmark the fund tracks, and its stated investment objective in a few words",
};

function buildFieldPrompt(
  ticker: string,
  companyName: string,
  field: RetrievedField
): string {
  return `Search for ${FIELD_QUESTIONS[field]} for ${companyName} (${ticker}).

Reply with exactly one line, in this pipe-delimited format, and nothing else:
${field} | value | source URL

Rules:
- The value MUST come from a page you actually retrieved, and the third column MUST be that page's URL.
- If you cannot find it from a real source, reply exactly: ${field} | Not found |
- Never state a figure you did not read on a retrieved page. A missing value is correct and useful; a guessed one is harmful.
- Prefer established financial press and official filings over blogs and aggregators.
- No commentary, headings, or any text outside that single line.`;
}

export function parseFacts(text: string): RetrievedFact[] {
  const byField = new Map<RetrievedField, RetrievedFact>();

  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_]+)\s*\|([^|]*)\|(.*)$/);
    if (!m) continue;
    const field = m[1].trim() as RetrievedField;
    if (!FIELDS.includes(field) || byField.has(field)) continue;

    const value = m[2].trim();
    const rawUrl = m[3].trim();
    const notFound = !value || /^not found$/i.test(value);

    // A figure without a usable source is treated as not found: an
    // unattributable number is exactly what this feature exists to remove.
    const usableUrl = /^https?:\/\//i.test(rawUrl) && !isBlocked(rawUrl) ? rawUrl : null;
    if (notFound || !usableUrl) {
      byField.set(field, {
        field,
        value: "Not found",
        url: null,
        domain: null,
        tier: null,
        note: null,
      });
      continue;
    }

    const assessment = assessSource(usableUrl);
    byField.set(field, {
      field,
      value,
      url: usableUrl,
      domain: assessment.domain,
      tier: assessment.tier,
      note: assessment.note,
    });
  }

  return FIELDS.map(
    (field) =>
      byField.get(field) ?? {
        field,
        value: "Not found",
        url: null,
        domain: null,
        tier: null,
        note: null,
      }
  );
}

interface SearchResultItem {
  url?: string;
  title?: string;
}

/** Pull every page the search actually consulted out of the response blocks. */
function extractConsulted(
  content: Anthropic.Messages.ContentBlock[]
): RetrievalResult["consulted"] {
  const seen = new Map<string, RetrievalResult["consulted"][number]>();
  for (const block of content) {
    if (block.type !== "web_search_tool_result") continue;
    const results = block.content;
    if (!Array.isArray(results)) continue;
    for (const item of results as SearchResultItem[]) {
      const url = item?.url;
      if (!url || isBlocked(url)) continue;
      const { domain, tier } = assessSource(url);
      if (!seen.has(url)) seen.set(url, { url, domain, tier });
    }
  }
  return [...seen.values()];
}

/**
 * Best-effort: any failure returns null and callers fall back to marking the
 * affected fields unsourced rather than filling them from memory.
 */
/**
 * Retrieval runs *alongside* generation rather than before it, because the
 * UI renders these facts directly from the stored note — the model never
 * needs to see them. The analysis therefore costs max(search, generation)
 * rather than the sum.
 *
 * Per-field timeout, not a shared one: the fields run concurrently, so the
 * set finishes in roughly the time of the slowest question.
 */
const FIELD_TIMEOUT_MS = 60_000;
/** Each question needs a search or two; more than this means it isn't there. */
const MAX_SEARCHES_PER_FIELD = 3;

const notFound = (field: RetrievedField): RetrievedFact => ({
  field,
  value: "Not found",
  url: null,
  domain: null,
  tier: null,
  note: null,
});

async function retrieveField(
  client: Anthropic,
  ticker: string,
  companyName: string,
  field: RetrievedField
): Promise<{ fact: RetrievedFact; consulted: RetrievalResult["consulted"] }> {
  try {
    const response = await client.messages.create(
      {
        model: config.anthropicModel,
        max_tokens: 1024,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: MAX_SEARCHES_PER_FIELD,
            blocked_domains: blockedDomains(),
          },
        ],
        messages: [
          { role: "user", content: buildFieldPrompt(ticker, companyName, field) },
        ],
      },
      { timeout: FIELD_TIMEOUT_MS }
    );

    if (response.stop_reason === "refusal") {
      return { fact: notFound(field), consulted: [] };
    }

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");

    // parseFacts returns every field; keep only the one asked for, so a
    // stray line about another field can't leak in unattributed.
    const parsed = parseFacts(text).find((f) => f.field === field);
    return {
      fact: parsed ?? notFound(field),
      consulted: extractConsulted(response.content),
    };
  } catch {
    // One field failing must not lose the others.
    return { fact: notFound(field), consulted: [] };
  }
}

export async function retrievePublicFacts(
  ticker: string,
  companyName: string,
  kind: "company" | "fund" = "company"
): Promise<RetrievalResult | null> {
  // maxRetries 0: the SDK otherwise retries timeouts, tripling the budget.
  const client = new Anthropic({ apiKey: config.anthropicApiKey, maxRetries: 0 });
  const wanted = kind === "fund" ? FUND_FIELDS : COMPANY_FIELDS;

  const results = await Promise.all(
    wanted.map((field) => retrieveField(client, ticker, companyName, field))
  );

  const consulted = new Map<string, RetrievalResult["consulted"][number]>();
  for (const r of results) {
    for (const page of r.consulted) {
      if (!consulted.has(page.url)) consulted.set(page.url, page);
    }
  }

  const facts = results.map((r) => r.fact);
  // Nothing sourced at all is indistinguishable from not having searched;
  // report null so the UI falls back rather than showing an empty result.
  if (facts.every((f) => f.url === null)) return null;

  return {
    facts,
    consulted: [...consulted.values()],
    searchedAt: new Date().toISOString(),
  };
}

/** Only facts that were actually found, for prompt injection. */
export function foundFacts(result: RetrievalResult | null): RetrievedFact[] {
  return (result?.facts ?? []).filter((f) => f.url !== null);
}
