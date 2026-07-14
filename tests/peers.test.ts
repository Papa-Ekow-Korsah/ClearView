import { describe, expect, it } from "vitest";
import { selectPeers, buildPeerRow, orderRows } from "@/lib/peers";
import type { PeerRow } from "@/types/analysis";

describe("selectPeers", () => {
  it("excludes the subject itself", () => {
    expect(selectPeers("NVDA", ["NVDA", "AMD", "INTC"])).toEqual([
      "AMD",
      "INTC",
    ]);
  });

  it("caps at 4 peers", () => {
    const picked = selectPeers("NVDA", ["A", "B", "C", "D", "E", "F"]);
    expect(picked).toHaveLength(4);
  });

  it("dedupes and normalises case", () => {
    expect(selectPeers("NVDA", ["amd", "AMD", "intc"])).toEqual([
      "AMD",
      "INTC",
    ]);
  });

  it("filters foreign/dotted listings", () => {
    expect(selectPeers("RHM", ["RHM.DE", "BA.L", "LMT"])).toEqual(["LMT"]);
  });

  it("handles empty and null-ish input", () => {
    expect(selectPeers("NVDA", [])).toEqual([]);
    expect(selectPeers("NVDA", ["", "  "])).toEqual([]);
  });
});

describe("buildPeerRow", () => {
  const metrics = {
    revenueGrowthTTMYoy: 70.65,
    grossMarginTTM: 74.2,
    operatingMarginTTM: 64.0,
    peTTM: 31.1,
    evEbitdaTTM: 50.5,
    "totalDebt/totalEquityQuarterly": 0.11,
    somethingElse: "text",
  };

  it("maps Finnhub metric keys onto the row", () => {
    const row = buildPeerRow("nvda", "NVIDIA Corp", metrics, 4_900_000, true);
    expect(row).toMatchObject({
      ticker: "NVDA",
      name: "NVIDIA Corp",
      marketCap: 4_900_000,
      revenueGrowthTTM: 70.65,
      grossMarginTTM: 74.2,
      operatingMarginTTM: 64.0,
      peTTM: 31.1,
      evEbitdaTTM: 50.5,
      debtToEquity: 0.11,
      isSubject: true,
    });
  });

  it("returns null for missing or non-numeric metrics", () => {
    const row = buildPeerRow("X", "X Corp", { peTTM: "n/a", evEbitdaTTM: NaN }, null);
    expect(row.peTTM).toBeNull();
    expect(row.evEbitdaTTM).toBeNull();
    expect(row.revenueGrowthTTM).toBeNull();
    expect(row.marketCap).toBeNull();
    expect(row.isSubject).toBe(false);
  });
});

describe("orderRows", () => {
  const mk = (ticker: string, marketCap: number | null, isSubject = false): PeerRow => ({
    ticker,
    name: ticker,
    marketCap,
    revenueGrowthTTM: null,
    grossMarginTTM: null,
    operatingMarginTTM: null,
    peTTM: null,
    evEbitdaTTM: null,
    debtToEquity: null,
    isSubject,
  });

  it("puts the subject first, then peers by market cap desc", () => {
    const rows = orderRows([
      mk("SMALL", 10),
      mk("BIG", 1000),
      mk("SUBJ", 5, true),
      mk("NOCAP", null),
    ]);
    expect(rows.map((r) => r.ticker)).toEqual(["SUBJ", "BIG", "SMALL", "NOCAP"]);
  });

  it("does not mutate the input", () => {
    const input = [mk("A", 1), mk("B", 2)];
    orderRows(input);
    expect(input.map((r) => r.ticker)).toEqual(["A", "B"]);
  });
});
