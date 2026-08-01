import type { DailyClose } from "@/lib/history";

/**
 * Track record scoring.
 *
 * Design decisions that make this honest rather than flattering:
 * - Scored against a BENCHMARK, not absolute. A BUY down 5% while the market
 *   is down 15% is a good call; absolute return mostly measures the market.
 * - Horizons are PRE-DECLARED (below), so you can't pick the window that
 *   flatters after seeing the result.
 * - HOLD is not a directional call and is excluded from hit rates rather
 *   than scored by price movement (category error).
 * - Deleted calls are still scored, so the record can't be curated.
 * - Repeat calls on one ticker are correlated, not independent evidence, so
 *   the distinct-ticker count is reported alongside the total.
 */

export const BENCHMARK_TICKER = "SPY";

/** Pre-declared scoring horizons, in days. */
export const HORIZONS = [30, 90, 180, 365] as const;
export type Horizon = (typeof HORIZONS)[number];

export type Signal = "BUY" | "HOLD" | "SELL";
export type Conviction = "low" | "medium" | "high";

export interface Call {
  id: number;
  ticker: string;
  companyName: string;
  signal: Signal;
  conviction: Conviction;
  /** ISO timestamp of generation */
  generatedAt: string;
  /** Price shown in the note at generation time */
  entryPrice: number;
  /** Whether the note was backed by verified SEC filing data */
  verified: boolean;
  /** Soft-deleted notes still count toward the record */
  deleted: boolean;
}

export interface HorizonResult {
  horizon: Horizon;
  stockReturnPct: number;
  benchmarkReturnPct: number;
  /** stock minus benchmark — the number that actually judges the call */
  alphaPct: number;
  /** null for HOLD, which isn't a directional call */
  correct: boolean | null;
}

export interface CallOutcome extends Call {
  daysElapsed: number;
  /** Live, not-yet-scored performance. Always present when prices resolve. */
  unrealized: {
    currentPrice: number;
    stockReturnPct: number;
    benchmarkReturnPct: number;
    alphaPct: number;
  } | null;
  /** One entry per horizon that has fully elapsed and has price data. */
  scored: HorizonResult[];
}

export interface HorizonAggregate {
  horizon: Horizon;
  /** Directional calls (BUY/SELL) with a matured result */
  scoredCalls: number;
  correctCalls: number;
  hitRatePct: number | null;
  avgAlphaPct: number | null;
  byConviction: {
    conviction: Conviction;
    scoredCalls: number;
    correctCalls: number;
    hitRatePct: number | null;
    avgAlphaPct: number | null;
  }[];
}

export interface TrackRecord {
  generatedAt: string;
  totalCalls: number;
  distinctTickers: number;
  directionalCalls: number;
  holdCalls: number;
  /** Calls too young for even the shortest horizon */
  pendingCalls: number;
  horizons: HorizonAggregate[];
  outcomes: CallOutcome[];
}

// ── price lookup ─────────────────────────────────────────────────

/**
 * Close on the given date, or the most recent close before it. Markets are
 * shut on weekends and holidays, so an exact-date lookup would miss.
 * Returns null if the series starts after the requested date.
 */
export function closeOnOrBefore(
  closes: DailyClose[],
  isoDate: string
): number | null {
  let best: number | null = null;
  for (const c of closes) {
    if (c.date <= isoDate) best = c.close;
    else break; // series is chronological
  }
  return best;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(fromIso: string, toIso: string): number {
  const a = new Date(`${fromIso.slice(0, 10)}T00:00:00Z`).getTime();
  const b = new Date(`${toIso.slice(0, 10)}T00:00:00Z`).getTime();
  return Math.floor((b - a) / 86_400_000);
}

function pctChange(from: number, to: number): number {
  return ((to - from) / from) * 100;
}

/** A directional call is right when it beat the benchmark in its direction. */
export function isCorrect(signal: Signal, alphaPct: number): boolean | null {
  if (signal === "BUY") return alphaPct > 0;
  if (signal === "SELL") return alphaPct < 0;
  return null; // HOLD
}

// ── per-call scoring ─────────────────────────────────────────────

export function computeOutcome(
  call: Call,
  stockCloses: DailyClose[],
  benchCloses: DailyClose[],
  now: Date = new Date()
): CallOutcome {
  const startDate = call.generatedAt.slice(0, 10);
  const todayIso = now.toISOString().slice(0, 10);
  const daysElapsed = Math.max(0, daysBetween(startDate, todayIso));

  const benchStart = closeOnOrBefore(benchCloses, startDate);
  const latestStock = stockCloses.length
    ? stockCloses[stockCloses.length - 1].close
    : null;
  const latestBench = benchCloses.length
    ? benchCloses[benchCloses.length - 1].close
    : null;

  let unrealized: CallOutcome["unrealized"] = null;
  if (latestStock !== null && benchStart !== null && latestBench !== null) {
    const stockReturnPct = pctChange(call.entryPrice, latestStock);
    const benchmarkReturnPct = pctChange(benchStart, latestBench);
    unrealized = {
      currentPrice: latestStock,
      stockReturnPct,
      benchmarkReturnPct,
      alphaPct: stockReturnPct - benchmarkReturnPct,
    };
  }

  const scored: HorizonResult[] = [];
  for (const horizon of HORIZONS) {
    if (daysElapsed < horizon) continue;
    const endDate = addDays(startDate, horizon);
    const stockEnd = closeOnOrBefore(stockCloses, endDate);
    const benchEnd = closeOnOrBefore(benchCloses, endDate);
    if (stockEnd === null || benchEnd === null || benchStart === null) continue;

    const stockReturnPct = pctChange(call.entryPrice, stockEnd);
    const benchmarkReturnPct = pctChange(benchStart, benchEnd);
    const alphaPct = stockReturnPct - benchmarkReturnPct;
    scored.push({
      horizon,
      stockReturnPct,
      benchmarkReturnPct,
      alphaPct,
      correct: isCorrect(call.signal, alphaPct),
    });
  }

  return { ...call, daysElapsed, unrealized, scored };
}

// ── aggregation ──────────────────────────────────────────────────

const CONVICTIONS: Conviction[] = ["high", "medium", "low"];

function summarize(results: { correct: boolean | null; alphaPct: number }[]) {
  const directional = results.filter((r) => r.correct !== null);
  const correctCalls = directional.filter((r) => r.correct === true).length;
  const avgAlphaPct = directional.length
    ? directional.reduce((sum, r) => sum + r.alphaPct, 0) / directional.length
    : null;
  return {
    scoredCalls: directional.length,
    correctCalls,
    hitRatePct: directional.length
      ? (correctCalls / directional.length) * 100
      : null,
    avgAlphaPct,
  };
}

export function aggregate(outcomes: CallOutcome[]): HorizonAggregate[] {
  return HORIZONS.map((horizon) => {
    const rows = outcomes.flatMap((o) => {
      const r = o.scored.find((s) => s.horizon === horizon);
      return r ? [{ conviction: o.conviction, ...r }] : [];
    });
    const overall = summarize(rows);
    return {
      horizon,
      ...overall,
      byConviction: CONVICTIONS.map((conviction) => ({
        conviction,
        ...summarize(rows.filter((r) => r.conviction === conviction)),
      })),
    };
  });
}

export function buildTrackRecord(
  outcomes: CallOutcome[],
  now: Date = new Date()
): TrackRecord {
  return {
    generatedAt: now.toISOString(),
    totalCalls: outcomes.length,
    distinctTickers: new Set(outcomes.map((o) => o.ticker)).size,
    directionalCalls: outcomes.filter((o) => o.signal !== "HOLD").length,
    holdCalls: outcomes.filter((o) => o.signal === "HOLD").length,
    pendingCalls: outcomes.filter((o) => o.scored.length === 0).length,
    horizons: aggregate(outcomes),
    outcomes,
  };
}
