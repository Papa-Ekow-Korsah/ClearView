import { describe, expect, it } from "vitest";
import {
  addDays,
  aggregate,
  buildTrackRecord,
  closeOnOrBefore,
  computeOutcome,
  daysBetween,
  isCorrect,
  type Call,
} from "@/lib/track-record";
import type { DailyClose } from "@/lib/history";

const series = (entries: [string, number][]): DailyClose[] =>
  entries.map(([date, close]) => ({ date, close }));

describe("closeOnOrBefore", () => {
  const closes = series([
    ["2026-01-02", 100],
    ["2026-01-05", 110],
    ["2026-01-06", 120],
  ]);

  it("finds an exact date match", () => {
    expect(closeOnOrBefore(closes, "2026-01-05")).toBe(110);
  });

  it("falls back to the last close before a market holiday or weekend", () => {
    // 3rd/4th are a weekend — should use Friday the 2nd
    expect(closeOnOrBefore(closes, "2026-01-04")).toBe(100);
  });

  it("returns the latest close for a date after the series", () => {
    expect(closeOnOrBefore(closes, "2026-03-01")).toBe(120);
  });

  it("returns null when the series starts after the date", () => {
    expect(closeOnOrBefore(closes, "2025-12-31")).toBeNull();
  });

  it("returns null for an empty series", () => {
    expect(closeOnOrBefore([], "2026-01-05")).toBeNull();
  });
});

describe("date helpers", () => {
  it("adds days across a month boundary", () => {
    expect(addDays("2026-01-20", 30)).toBe("2026-02-19");
  });

  it("counts elapsed days", () => {
    expect(daysBetween("2026-01-01", "2026-01-31")).toBe(30);
  });
});

describe("isCorrect", () => {
  it("scores a BUY on beating the benchmark", () => {
    expect(isCorrect("BUY", 2)).toBe(true);
    expect(isCorrect("BUY", -2)).toBe(false);
  });

  it("scores a SELL on trailing the benchmark", () => {
    expect(isCorrect("SELL", -2)).toBe(true);
    expect(isCorrect("SELL", 2)).toBe(false);
  });

  it("does not score HOLD directionally", () => {
    expect(isCorrect("HOLD", 5)).toBeNull();
    expect(isCorrect("HOLD", -5)).toBeNull();
  });
});

const baseCall: Call = {
  id: 1,
  ticker: "TEST",
  companyName: "Test Corp",
  signal: "BUY",
  conviction: "high",
  generatedAt: "2026-01-01T12:00:00.000Z",
  entryPrice: 100,
  verified: true,
  deleted: false,
};

// Stock falls 5%; benchmark falls 15% over the same window.
const stock = series([
  ["2026-01-01", 100],
  ["2026-01-31", 95],
]);
const bench = series([
  ["2026-01-01", 400],
  ["2026-01-31", 340],
]);

describe("computeOutcome", () => {
  const now = new Date("2026-02-05T00:00:00.000Z");

  it("scores a BUY that fell less than the market as correct", () => {
    const out = computeOutcome(baseCall, stock, bench, now);
    const r = out.scored.find((s) => s.horizon === 30)!;
    expect(r.stockReturnPct).toBeCloseTo(-5, 5);
    expect(r.benchmarkReturnPct).toBeCloseTo(-15, 5);
    expect(r.alphaPct).toBeCloseTo(10, 5);
    expect(r.correct).toBe(true);
  });

  it("only scores horizons that have fully elapsed", () => {
    const out = computeOutcome(baseCall, stock, bench, now);
    expect(out.scored.map((s) => s.horizon)).toEqual([30]);
    expect(out.daysElapsed).toBe(35);
  });

  it("reports unrealized performance before any horizon matures", () => {
    const early = new Date("2026-01-10T00:00:00.000Z");
    const out = computeOutcome(baseCall, stock, bench, early);
    expect(out.scored).toHaveLength(0);
    expect(out.unrealized).not.toBeNull();
    expect(out.unrealized!.alphaPct).toBeCloseTo(10, 5);
  });

  it("leaves HOLD unscored even once the horizon matures", () => {
    const hold = { ...baseCall, signal: "HOLD" as const };
    const out = computeOutcome(hold, stock, bench, now);
    expect(out.scored[0].correct).toBeNull();
  });

  it("degrades gracefully when price data is missing", () => {
    const out = computeOutcome(baseCall, [], [], now);
    expect(out.unrealized).toBeNull();
    expect(out.scored).toHaveLength(0);
  });
});

describe("aggregate", () => {
  const now = new Date("2026-02-05T00:00:00.000Z");

  it("computes hit rate and average alpha per horizon, splitting by conviction", () => {
    const winner = computeOutcome(baseCall, stock, bench, now);
    // Stock rises 5% while the benchmark rises 15% — a losing BUY.
    const loser = computeOutcome(
      { ...baseCall, id: 2, conviction: "low" },
      series([
        ["2026-01-01", 100],
        ["2026-01-31", 105],
      ]),
      series([
        ["2026-01-01", 400],
        ["2026-01-31", 460],
      ]),
      now
    );

    const [thirtyDay] = aggregate([winner, loser]);
    expect(thirtyDay.scoredCalls).toBe(2);
    expect(thirtyDay.correctCalls).toBe(1);
    expect(thirtyDay.hitRatePct).toBe(50);

    const high = thirtyDay.byConviction.find((c) => c.conviction === "high")!;
    const low = thirtyDay.byConviction.find((c) => c.conviction === "low")!;
    expect(high.hitRatePct).toBe(100);
    expect(low.hitRatePct).toBe(0);
  });

  it("reports null rather than zero when nothing has matured", () => {
    const early = new Date("2026-01-10T00:00:00.000Z");
    const pending = computeOutcome(baseCall, stock, bench, early);
    const [thirtyDay] = aggregate([pending]);
    expect(thirtyDay.scoredCalls).toBe(0);
    expect(thirtyDay.hitRatePct).toBeNull();
  });
});

describe("buildTrackRecord", () => {
  const now = new Date("2026-02-05T00:00:00.000Z");

  it("counts deleted calls so the record cannot be curated", () => {
    const kept = computeOutcome(baseCall, stock, bench, now);
    const deleted = computeOutcome(
      { ...baseCall, id: 2, deleted: true },
      stock,
      bench,
      now
    );
    const record = buildTrackRecord([kept, deleted], now);
    expect(record.totalCalls).toBe(2);
    expect(record.horizons[0].scoredCalls).toBe(2);
  });

  it("surfaces repeat calls on one ticker via the distinct-ticker count", () => {
    const a = computeOutcome(baseCall, stock, bench, now);
    const b = computeOutcome({ ...baseCall, id: 2 }, stock, bench, now);
    const record = buildTrackRecord([a, b], now);
    expect(record.totalCalls).toBe(2);
    expect(record.distinctTickers).toBe(1);
  });

  it("separates HOLDs from directional calls", () => {
    const buy = computeOutcome(baseCall, stock, bench, now);
    const hold = computeOutcome(
      { ...baseCall, id: 2, signal: "HOLD" },
      stock,
      bench,
      now
    );
    const record = buildTrackRecord([buy, hold], now);
    expect(record.directionalCalls).toBe(1);
    expect(record.holdCalls).toBe(1);
  });
});
