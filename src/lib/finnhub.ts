import { config } from "@/lib/config";

/**
 * Server-side Finnhub client. Free tier: 60 req/min. A short in-memory
 * cache smooths repeated calls within one serverless instance (best-effort
 * on Vercel — the DB-backed rate limiter is the hard quota guard).
 */

const BASE = "https://finnhub.io/api/v1";

class FinnhubError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "FinnhubError";
  }
}

export { FinnhubError };

const cache = new Map<string, { expires: number; data: unknown }>();

async function get<T>(path: string, ttlMs: number): Promise<T> {
  const hit = cache.get(path);
  if (hit && hit.expires > Date.now()) return hit.data as T;

  const sep = path.includes("?") ? "&" : "?";
  const res = await fetch(`${BASE}${path}${sep}token=${config.finnhubApiKey}`, {
    // Route-level caching is handled by our own map; don't double-cache.
    cache: "no-store",
  });

  if (res.status === 429) {
    throw new FinnhubError(
      "Finnhub rate limit hit (60 requests/min on the free tier). Wait a minute and try again.",
      429
    );
  }
  if (res.status === 401 || res.status === 403) {
    throw new FinnhubError(
      "Finnhub rejected the API key. Check FINNHUB_API_KEY in your environment.",
      res.status
    );
  }
  if (!res.ok) {
    throw new FinnhubError(
      `Finnhub request failed (HTTP ${res.status}) for ${path.split("?")[0]}.`,
      res.status
    );
  }

  const data = (await res.json()) as T;
  cache.set(path, { expires: Date.now() + ttlMs, data });
  return data;
}

// ── Response shapes (fields we use) ──────────────────────────────

export interface Quote {
  c: number; // current price
  d: number | null; // change
  dp: number | null; // change %
  h: number;
  l: number;
  o: number;
  pc: number; // previous close
}

export interface Profile {
  name?: string;
  ticker?: string;
  exchange?: string;
  finnhubIndustry?: string;
  marketCapitalization?: number; // millions
  currency?: string;
  ipo?: string;
  weburl?: string;
}

export interface MetricsResponse {
  metric: Record<string, number | string | null>;
}

export interface NewsItem {
  headline: string;
  datetime: number; // unix seconds
  source: string;
  summary: string;
  url: string;
}

// ── Endpoints ────────────────────────────────────────────────────

const MIN = 60_000;

export function getQuote(ticker: string): Promise<Quote> {
  return get<Quote>(`/quote?symbol=${encodeURIComponent(ticker)}`, 0.5 * MIN);
}

export function getProfile(ticker: string): Promise<Profile> {
  return get<Profile>(
    `/stock/profile2?symbol=${encodeURIComponent(ticker)}`,
    60 * MIN
  );
}

export function getMetrics(ticker: string): Promise<MetricsResponse> {
  return get<MetricsResponse>(
    `/stock/metric?symbol=${encodeURIComponent(ticker)}&metric=all`,
    15 * MIN
  );
}

export function getPeerSymbols(ticker: string): Promise<string[]> {
  return get<string[]>(
    `/stock/peers?symbol=${encodeURIComponent(ticker)}`,
    60 * MIN
  );
}

export async function getRecentNews(ticker: string): Promise<NewsItem[]> {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 3600 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  const items = await get<NewsItem[]>(
    `/company-news?symbol=${encodeURIComponent(ticker)}&from=${fmt(from)}&to=${fmt(to)}`,
    15 * MIN
  );
  return Array.isArray(items) ? items : [];
}

/** A profile with no name means Finnhub doesn't know the ticker. */
export function isUnknownTicker(profile: Profile): boolean {
  return !profile.name;
}
