/**
 * 5-day close history for sparklines. Finnhub moved /stock/candle behind a
 * paid plan and Stooq now blocks non-browser clients, so we use Yahoo
 * Finance's public chart API (free JSON, no key; needs a browser-ish UA).
 * Best-effort: any failure returns [] and the UI hides the spark.
 */

const cache = new Map<string, { expires: number; closes: number[] }>();
const HOUR = 3_600_000;

interface YahooChart {
  chart?: {
    result?: {
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}

export async function getFiveDayCloses(ticker: string): Promise<number[]> {
  const key = ticker.toUpperCase();
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.closes;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(key)}?range=5d&interval=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0 (ClearView personal research tool)" },
        cache: "no-store",
      }
    );
    if (!res.ok) return [];
    const data = (await res.json()) as YahooChart;
    const closes = (
      data.chart?.result?.[0]?.indicators?.quote?.[0]?.close ?? []
    )
      .filter((n): n is number => typeof n === "number" && Number.isFinite(n))
      .slice(-5);
    cache.set(key, { expires: Date.now() + HOUR, closes });
    return closes;
  } catch {
    return [];
  }
}
