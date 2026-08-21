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
  | "GUIDANCE";

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

const FIELDS: RetrievedField[] = [
  "REVENUE_CONSENSUS",
  "ANALYST_RATING",
  "PRICE_TARGET",
  "RECENT_MOVES",
  "GUIDANCE",
];

function buildPrompt(ticker: string, companyName: string): string {
  return `Find these specific published facts about ${companyName} (${ticker}). Search only as much as needed.

Return ONE LINE PER FIELD, in exactly this pipe-delimited format, and nothing else:
FIELD | value | source URL

Fields to return, in this order:
REVENUE_CONSENSUS — the Wall Street consensus revenue estimate for the most recently reported quarter (what analysts expected, not what the company reported)
ANALYST_RATING — the current consensus analyst rating (e.g. "Buy", "Hold", 24 buy / 3 hold)
PRICE_TARGET — the current average analyst price target
RECENT_MOVES — up to two notable analyst rating or target changes in the last 30 days, semicolon-separated
GUIDANCE — management's own guidance for the current or next quarter, as reported

Rules:
- Every value MUST come from a page you actually retrieved, and the third column MUST be that page's URL.
- If you cannot find a field from a real source, write exactly: FIELD | Not found |
- Never state a figure you did not read on a retrieved page. A missing value is correct and useful; a guessed one is harmful.
- Prefer established financial press and official filings over blogs and aggregators.
- Do not add commentary, headings, or any text outside the five lines.`;
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
export async function retrievePublicFacts(
  ticker: string,
  companyName: string
): Promise<RetrievalResult | null> {
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  try {
    let response = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 4096,
      tools: [
        {
          type: "web_search_20260209",
          name: "web_search",
          max_uses: 6,
          blocked_domains: blockedDomains(),
        },
      ],
      messages: [{ role: "user", content: buildPrompt(ticker, companyName) }],
    });

    // Server-side tool loops can pause; resume by re-sending the turn.
    let guard = 0;
    const messages: Anthropic.Messages.MessageParam[] = [
      { role: "user", content: buildPrompt(ticker, companyName) },
    ];
    while (response.stop_reason === "pause_turn" && guard++ < 3) {
      messages.push({ role: "assistant", content: response.content });
      response = await client.messages.create({
        model: config.anthropicModel,
        max_tokens: 4096,
        tools: [
          {
            type: "web_search_20260209",
            name: "web_search",
            max_uses: 6,
            blocked_domains: blockedDomains(),
          },
        ],
        messages,
      });
    }

    if (response.stop_reason === "refusal") return null;

    const text = response.content
      .filter((b): b is Anthropic.Messages.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    if (!text.trim()) return null;

    return {
      facts: parseFacts(text),
      consulted: extractConsulted(response.content),
      searchedAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/** Only facts that were actually found, for prompt injection. */
export function foundFacts(result: RetrievalResult | null): RetrievedFact[] {
  return (result?.facts ?? []).filter((f) => f.url !== null);
}
