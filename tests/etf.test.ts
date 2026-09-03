import { describe, expect, it } from "vitest";
import {
  annualisedVolatility,
  betaAgainst,
  computePerformance,
  dailyReturns,
  maxDrawdown,
} from "@/lib/etf";
import type { DailyClose } from "@/lib/history";

/** Build a daily series ending today, so window coverage is realistic. */
function series(values: number[], endIso = "2026-08-25"): DailyClose[] {
  const end = new Date(`${endIso}T00:00:00Z`);
  return values.map((close, i) => {
    const d = new Date(end);
    d.setUTCDate(d.getUTCDate() - (values.length - 1 - i));
    return { date: d.toISOString().slice(0, 10), close };
  });
}

describe("dailyReturns", () => {
  it("computes simple period returns", () => {
    const r = dailyReturns(series([100, 110, 99]));
    expect(r[0]).toBeCloseTo(0.1, 10);
    expect(r[1]).toBeCloseTo(-0.1, 10);
  });

  it("needs at least two points", () => {
    expect(dailyReturns(series([100]))).toEqual([]);
  });
});

describe("maxDrawdown", () => {
  it("measures peak to trough, not first to last", () => {
    // Rises to 150, falls to 75 (-50%), recovers to 140.
    expect(maxDrawdown(series([100, 150, 75, 140]))).toBeCloseTo(-50, 5);
  });

  it("is zero for a series that only rises", () => {
    expect(maxDrawdown(series([100, 110, 120]))).toBe(0);
  });

  it("returns null without enough history", () => {
    expect(maxDrawdown([])).toBeNull();
  });
});

describe("annualisedVolatility", () => {
  it("is zero for a flat series", () => {
    expect(annualisedVolatility(series(Array(60).fill(100)))).toBeCloseTo(0, 8);
  });

  it("rises with volatility", () => {
    const calm = series(Array.from({ length: 60 }, (_, i) => 100 + i * 0.1));
    const wild = series(Array.from({ length: 60 }, (_, i) => 100 + (i % 2 ? 8 : -8)));
    expect(annualisedVolatility(wild)!).toBeGreaterThan(annualisedVolatility(calm)!);
  });

  it("refuses to report on too few observations", () => {
    expect(annualisedVolatility(series([100, 101, 102]))).toBeNull();
  });
});

describe("betaAgainst", () => {
  it("is about 1 when the fund tracks the benchmark exactly", () => {
    const vals = Array.from({ length: 80 }, (_, i) => 100 + (i % 3) * 2 + i * 0.05);
    expect(betaAgainst(series(vals), series(vals))!).toBeCloseTo(1, 6);
  });

  it("is about 2 for a fund that moves twice as hard", () => {
    const bench = Array.from({ length: 80 }, (_, i) => 100 * (1 + (i % 5 === 0 ? 0.01 : -0.002) * i * 0.1));
    const benchSeries = series(bench);
    const benchRets = dailyReturns(benchSeries);
    // Rebuild a fund whose daily returns are exactly double the benchmark's.
    const fundVals = [100];
    for (const r of benchRets) fundVals.push(fundVals[fundVals.length - 1] * (1 + 2 * r));
    expect(betaAgainst(series(fundVals), benchSeries)!).toBeCloseTo(2, 1);
  });

  it("returns null when the overlap is too short to mean anything", () => {
    expect(betaAgainst(series([100, 101]), series([100, 101]))).toBeNull();
  });
});

describe("computePerformance", () => {
  const now = new Date("2026-08-25T00:00:00Z");

  it("computes fund, benchmark and alpha per window", () => {
    // 400 days of history so every window is covered.
    const fund = series(Array.from({ length: 400 }, (_, i) => 100 + i * 0.5));
    const bench = series(Array.from({ length: 400 }, (_, i) => 200 + i * 0.5));
    const perf = computePerformance(fund, bench, now);
    const oneYear = perf.windows.find((w) => w.days === 365)!;
    expect(oneYear.fundPct).not.toBeNull();
    expect(oneYear.benchmarkPct).not.toBeNull();
    expect(oneYear.alphaPct).toBeCloseTo(
      oneYear.fundPct! - oneYear.benchmarkPct!,
      6
    );
    // Same absolute gain on a smaller base means the fund outperforms.
    expect(oneYear.alphaPct!).toBeGreaterThan(0);
  });

  it("refuses windows the history does not cover, so a young fund isn't flattered", () => {
    const shortHistory = series(Array.from({ length: 40 }, (_, i) => 100 + i));
    const bench = series(Array.from({ length: 400 }, (_, i) => 200 + i * 0.5));
    const perf = computePerformance(shortHistory, bench, now);
    expect(perf.windows.find((w) => w.days === 30)!.fundPct).not.toBeNull();
    expect(perf.windows.find((w) => w.days === 365)!.fundPct).toBeNull();
    expect(perf.windows.find((w) => w.days === 365)!.alphaPct).toBeNull();
  });

  it("reports the data range it actually used", () => {
    const fund = series(Array.from({ length: 100 }, () => 100));
    const perf = computePerformance(fund, fund, now);
    expect(perf.observations).toBe(100);
    expect(perf.to).toBe("2026-08-25");
    expect(perf.benchmark).toBe("SPY");
  });

  it("degrades to nulls rather than guessing when there is no data", () => {
    const perf = computePerformance([], [], now);
    expect(perf.windows.every((w) => w.fundPct === null)).toBe(true);
    expect(perf.annualisedVolPct).toBeNull();
    expect(perf.maxDrawdownPct).toBeNull();
    expect(perf.betaVsBenchmark).toBeNull();
  });
});
