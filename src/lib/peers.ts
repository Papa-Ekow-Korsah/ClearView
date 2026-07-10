import type { PeerRow } from "@/types/analysis";

/**
 * Peer selection and comparison-row building. Pure functions — unit tested.
 */

const MAX_PEERS = 4;

/**
 * Pick up to MAX_PEERS peer tickers from Finnhub's peer list.
 * Filters out the subject itself, duplicates, and non-primary listings
 * (tickers with dots — foreign listings like RHM.DE or share classes).
 */
export function selectPeers(subject: string, candidates: string[]): string[] {
  const seen = new Set<string>([subject.toUpperCase()]);
  const picked: string[] = [];
  for (const raw of candidates ?? []) {
    const t = (raw ?? "").toUpperCase().trim();
    if (!t || seen.has(t)) continue;
    if (t.includes(".")) continue;
    seen.add(t);
    picked.push(t);
    if (picked.length >= MAX_PEERS) break;
  }
  return picked;
}

type MetricMap = Record<string, number | string | null>;

function num(metrics: MetricMap, key: string): number | null {
  const v = metrics?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Build one comparison row from Finnhub's `metric=all` payload.
 * Every number is straight from the data source — the AI never touches these.
 */
export function buildPeerRow(
  ticker: string,
  name: string,
  metrics: MetricMap,
  marketCap: number | null,
  isSubject = false
): PeerRow {
  return {
    ticker: ticker.toUpperCase(),
    name,
    marketCap,
    revenueGrowthTTM: num(metrics, "revenueGrowthTTMYoy"),
    grossMarginTTM: num(metrics, "grossMarginTTM"),
    operatingMarginTTM: num(metrics, "operatingMarginTTM"),
    peTTM: num(metrics, "peTTM"),
    evEbitdaTTM: num(metrics, "enterpriseValue/ebitdaTTM"),
    netDebtToEbitda: num(metrics, "netDebt/ebitdaTTM"),
    isSubject,
  };
}

/**
 * Rank rows so the subject is first, then peers by market cap descending
 * (largest, most-relevant comparables at the top of the table).
 */
export function orderRows(rows: PeerRow[]): PeerRow[] {
  return [...rows].sort((a, b) => {
    if (a.isSubject !== b.isSubject) return a.isSubject ? -1 : 1;
    return (b.marketCap ?? 0) - (a.marketCap ?? 0);
  });
}
