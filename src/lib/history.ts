/**
 * Daily close history. Finnhub moved /stock/candle behind a paid plan and
 * Stooq now blocks non-browser clients, so we use Yahoo Finance's public
 * chart API (free JSON, no key; needs a browser-ish UA).
 * Best-effort: any failure returns [] and callers degrade gracefully.
 */

export interface DailyClose {
  /** YYYY-MM-DD (UTC) */
  date: string;
  close: number;
}

const cache = new Map<string, { expires: number; closes: DailyClose[] }>();
const HOUR = 3_600_000;

interface YahooChart {
  chart?: {
    result?: {
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

export async function getDailyCloses(
  ticker: string,
  range = "2y"
): Promise<DailyClose[]> {
  const key = `${ticker.toUpperCase()}:${range}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.closes;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
        ticker.toUpperCase()
      )}?range=${range}&interval=1d`,
      {
        headers: {
          "User-Agent": "Mozilla/5.0 (ClearView personal research tool)",
        },
        cache: "no-store",
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as YahooChart;
    const result = data.chart?.result?.[0];
    const stamps = result?.timestamp ?? [];
    const closes = result?.indicators?.quote?.[0]?.close ?? [];

    const series: DailyClose[] = [];
    for (let i = 0; i < stamps.length; i++) {
      const c = closes[i];
      if (typeof c === "number" && Number.isFinite(c)) {
        series.push({
          date: new Date(stamps[i] * 1000).toISOString().slice(0, 10),
          close: c,
        });
      }
    }
    cache.set(key, { expires: Date.now() + HOUR, closes: series });
    return series;
  } catch {
    return [];
  }
}

/** Last 5 closes, for watchlist sparklines. */
export async function getFiveDayCloses(ticker: string): Promise<number[]> {
  const series = await getDailyCloses(ticker, "5d");
  return series.slice(-5).map((d) => d.close);
}
