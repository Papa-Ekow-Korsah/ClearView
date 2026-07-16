import {
  RATIO_KEYS,
  RATIO_LABELS,
  type RatioKey,
  type RatioValue,
} from "@/types/analysis-v2";

type MetricMap = Record<string, number | string | null>;

/** Finnhub metric=all key for each of our fixed ratio keys. */
const FINNHUB_KEYS: Record<RatioKey, string> = {
  peTTM: "peTTM",
  evEbitdaTTM: "evEbitdaTTM",
  psTTM: "psTTM",
  roeTTM: "roeTTM",
  debtToEquity: "totalDebt/totalEquityQuarterly",
  currentRatio: "currentRatioQuarterly",
};

function num(metrics: MetricMap, key: string): number | null {
  const v = metrics?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Build the verified ratio rows for the Ratios tab: the subject's value plus
 * each peer's, straight from Finnhub. The AI writes interpretation *around*
 * these; it never supplies the values.
 */
export function buildRatioValues(
  subjectMetrics: MetricMap,
  peerMetrics: { ticker: string; metrics: MetricMap }[]
): RatioValue[] {
  return RATIO_KEYS.map((key) => ({
    key,
    label: RATIO_LABELS[key],
    value: num(subjectMetrics, FINNHUB_KEYS[key]),
    peerValues: peerMetrics.map((p) => ({
      ticker: p.ticker,
      value: num(p.metrics, FINNHUB_KEYS[key]),
    })),
  }));
}
