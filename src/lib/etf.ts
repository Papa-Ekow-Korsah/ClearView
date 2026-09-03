import { getDailyCloses, type DailyClose } from "@/lib/history";
import { closeOnOrBefore, addDays, BENCHMARK_TICKER } from "@/lib/track-record";
import { config } from "@/lib/config";

/**
 * ETF support.
 *
 * A fund has no revenue, margins, filings or management, so none of the
 * company note applies. What it does have is a price history — and for a
 * fund, performance and risk characteristics ARE the fundamentals. Those are
 * computed here from real closes, server-side, exactly as company margins
 * are computed from filings. The model never produces these numbers.
 *
 * Holdings, expense ratio and AUM sit behind Finnhub's paid tier, so those
 * come from web retrieval with citations instead — sourced, not verified,
 * and labelled as such.
 */

// ── identification ───────────────────────────────────────────────

export type SecurityKind = "company" | "fund" | "unknown";

export interface SecurityIdentity {
  kind: SecurityKind;
  /** Official name where a source provided one. */
  name: string | null;
  /** Which source settled the classification, for transparency. */
  via: string | null;
}

interface FinnhubSearchResult {
  count?: number;
  result?: { symbol?: string; description?: string; type?: string }[];
}

/** Finnhub marks funds as ETP; Yahoo reports instrumentType ETF. */
export async function classifySecurity(
  ticker: string
): Promise<SecurityIdentity> {
  const symbol = ticker.toUpperCase();

  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/search?q=${encodeURIComponent(symbol)}&exchange=US&token=${config.finnhubApiKey}`,
      { cache: "no-store" }
    );
    if (res.ok) {
      const data = (await res.json()) as FinnhubSearchResult;
      const exact = (data.result ?? []).find(
        (r) => r.symbol?.toUpperCase() === symbol
      );
      if (exact?.type) {
        const type = exact.type.toUpperCase();
        if (type.includes("ETP") || type.includes("ETF") || type.includes("FUND")) {
          return { kind: "fund", name: exact.description ?? null, via: "Finnhub" };
        }
        return { kind: "company", name: exact.description ?? null, via: "Finnhub" };
      }
    }
  } catch {
    // fall through to Yahoo
  }

  // Second opinion, and the fallback when search is unavailable.
  const meta = await getChartMeta(symbol);
  if (meta?.instrumentType) {
    const t = meta.instrumentType.toUpperCase();
    const name = meta.longName ?? meta.shortName ?? null;
    if (t === "ETF" || t === "MUTUALFUND") return { kind: "fund", name, via: "Yahoo" };
    if (t === "EQUITY") return { kind: "company", name, via: "Yahoo" };
  }

  return { kind: "unknown", name: null, via: null };
}

// ── price metadata ───────────────────────────────────────────────

export interface ChartMeta {
  instrumentType?: string;
  longName?: string;
  shortName?: string;
  currency?: string;
  fullExchangeName?: string;
  regularMarketPrice?: number;
  regularMarketChangePercent?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  firstTradeDate?: number;
}

const metaCache = new Map<string, { expires: number; meta: ChartMeta | null }>();

export async function getChartMeta(ticker: string): Promise<ChartMeta | null> {
  const key = ticker.toUpperCase();
  const hit = metaCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.meta;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=1d&interval=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (ClearView personal research tool)",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const meta = (data?.chart?.result?.[0]?.meta ?? null) as ChartMeta | null;
    metaCache.set(key, { expires: Date.now() + 900_000, meta });
    return meta;
  } catch {
    return null;
  }
}

// ── computed performance (verified) ──────────────────────────────

export interface PerformanceWindow {
  label: string;
  days: number;
  fundPct: number | null;
  benchmarkPct: number | null;
  /** Fund minus benchmark; null when either leg is missing. */
  alphaPct: number | null;
}

export interface EtfPerformance {
  windows: PerformanceWindow[];
  /** Annualised standard deviation of daily returns, in percent. */
  annualisedVolPct: number | null;
  /** Worst peak-to-trough fall over the available history, in percent. */
  maxDrawdownPct: number | null;
  /** Sensitivity to the benchmark, computed from overlapping daily returns. */
  betaVsBenchmark: number | null;
  observations: number;
  from: string | null;
  to: string | null;
  benchmark: string;
}

export const PERFORMANCE_WINDOWS: { label: string; days: number }[] = [
  { label: "1 month", days: 30 },
  { label: "3 months", days: 91 },
  { label: "6 months", days: 182 },
  { label: "1 year", days: 365 },
];

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

/** Simple daily returns from a close series. */
export function dailyReturns(closes: DailyClose[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1].close;
    if (prev > 0) out.push(closes[i].close / prev - 1);
  }
  return out;
}

export function annualisedVolatility(closes: DailyClose[]): number | null {
  const rets = dailyReturns(closes);
  if (rets.length < 20) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const variance =
    rets.reduce((sum, r) => sum + (r - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252) * 100;
}

/** Worst peak-to-trough decline, as a negative percentage. */
export function maxDrawdown(closes: DailyClose[]): number | null {
  if (closes.length < 2) return null;
  let peak = closes[0].close;
  let worst = 0;
  for (const { close } of closes) {
    if (close > peak) peak = close;
    if (peak > 0) {
      const dd = (close / peak - 1) * 100;
      if (dd < worst) worst = dd;
    }
  }
  return worst;
}

/** Covariance-based beta over dates present in both series. */
export function betaAgainst(
  closes: DailyClose[],
  benchCloses: DailyClose[]
): number | null {
  const benchByDate = new Map(benchCloses.map((c) => [c.date, c.close]));
  const paired: DailyClose[][] = [[], []];
  for (const c of closes) {
    const b = benchByDate.get(c.date);
    if (b !== undefined) {
      paired[0].push(c);
      paired[1].push({ date: c.date, close: b });
    }
  }
  const fund = dailyReturns(paired[0]);
  const bench = dailyReturns(paired[1]);
  if (fund.length < 30) return null;

  const meanF = fund.reduce((a, b) => a + b, 0) / fund.length;
  const meanB = bench.reduce((a, b) => a + b, 0) / bench.length;
  let cov = 0;
  let varB = 0;
  for (let i = 0; i < fund.length; i++) {
    cov += (fund[i] - meanF) * (bench[i] - meanB);
    varB += (bench[i] - meanB) ** 2;
  }
  return varB === 0 ? null : cov / varB;
}

export function computePerformance(
  closes: DailyClose[],
  benchCloses: DailyClose[],
  now: Date = new Date()
): EtfPerformance {
  const today = now.toISOString().slice(0, 10);
  const latest = closes.length ? closes[closes.length - 1].close : null;
  const latestBench = benchCloses.length
    ? benchCloses[benchCloses.length - 1].close
    : null;

  const windows = PERFORMANCE_WINDOWS.map(({ label, days }) => {
    const start = addDays(today, -days);
    const fundStart = closeOnOrBefore(closes, start);
    const benchStart = closeOnOrBefore(benchCloses, start);

    // Only score a window the history actually covers, so a young fund
    // doesn't get a flattering partial-period return.
    const covered = closes.length > 0 && closes[0].date <= start;
    const fundPct =
      covered && fundStart !== null && latest !== null
        ? pctChange(fundStart, latest)
        : null;
    const benchmarkPct =
      benchStart !== null && latestBench !== null
        ? pctChange(benchStart, latestBench)
        : null;

    return {
      label,
      days,
      fundPct,
      benchmarkPct,
      alphaPct:
        fundPct !== null && benchmarkPct !== null ? fundPct - benchmarkPct : null,
    };
  });

  return {
    windows,
    annualisedVolPct: annualisedVolatility(closes),
    maxDrawdownPct: maxDrawdown(closes),
    betaVsBenchmark: betaAgainst(closes, benchCloses),
    observations: closes.length,
    from: closes.length ? closes[0].date : null,
    to: closes.length ? closes[closes.length - 1].date : null,
    benchmark: BENCHMARK_TICKER,
  };
}

/** Everything verifiable about a fund, with no model involvement. */
export interface EtfSnapshot {
  ticker: string;
  name: string | null;
  currency: string | null;
  exchange: string | null;
  price: number | null;
  dayChangePct: number | null;
  week52High: number | null;
  week52Low: number | null;
  /** Yahoo's first trade date, the closest free proxy for inception. */
  firstTradeDate: string | null;
  performance: EtfPerformance;
}

export async function buildEtfSnapshot(
  ticker: string,
  name: string | null
): Promise<EtfSnapshot> {
  const [meta, closes, benchCloses] = await Promise.all([
    getChartMeta(ticker),
    getDailyCloses(ticker, "2y"),
    getDailyCloses(BENCHMARK_TICKER, "2y"),
  ]);

  return {
    ticker: ticker.toUpperCase(),
    name: name ?? meta?.longName ?? meta?.shortName ?? null,
    currency: meta?.currency ?? null,
    exchange: meta?.fullExchangeName ?? null,
    price: meta?.regularMarketPrice ?? null,
    dayChangePct: meta?.regularMarketChangePercent ?? null,
    week52High: meta?.fiftyTwoWeekHigh ?? null,
    week52Low: meta?.fiftyTwoWeekLow ?? null,
    firstTradeDate: meta?.firstTradeDate
      ? new Date(meta.firstTradeDate * 1000).toISOString().slice(0, 10)
      : null,
    performance: computePerformance(closes, benchCloses),
  };
}
