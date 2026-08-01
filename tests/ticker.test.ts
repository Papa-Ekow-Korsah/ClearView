import { describe, expect, it } from "vitest";
import { validateTicker } from "@/lib/ticker";

describe("validateTicker", () => {
  it("accepts US symbols and normalises them", () => {
    expect(validateTicker("aapl")).toEqual({ ok: true, ticker: "AAPL" });
    expect(validateTicker("  nvda  ")).toEqual({ ok: true, ticker: "NVDA" });
  });

  it("explains the US-only scope for exchange-suffixed tickers", () => {
    const uk = validateTicker("TSCO.L");
    expect(uk.ok).toBe(false);
    expect(uk.error).toMatch(/US-listed/);
    expect(uk.error).toMatch(/London Stock Exchange/);
    // Should point at the workaround rather than dead-end
    expect(uk.error).toMatch(/ADR/);
  });

  it("names other exchanges it recognises", () => {
    expect(validateTicker("600519.SS").error).toMatch(/Shanghai/);
    expect(validateTicker("7203.T").error).toMatch(/Tokyo/);
  });

  it("still handles an unknown suffix as a scope problem, not a format one", () => {
    const out = validateTicker("ABC.ZZ");
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/US-listed/);
  });

  it("falls back to the format error for genuine junk", () => {
    expect(validateTicker("").error).toMatch(/1-6 letters/);
    expect(validateTicker("TOOLONG7").error).toMatch(/1-6 letters/);
    expect(validateTicker("AA PL").error).toMatch(/1-6 letters/);
  });
});
