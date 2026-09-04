import { describe, expect, it } from "vitest";
import { classifyConsensus } from "@/lib/consensus";

describe("classifyConsensus", () => {
  it("reads a plain rating", () => {
    expect(classifyConsensus("Hold")).toBe("Hold");
    expect(classifyConsensus("Buy")).toBe("Buy");
    expect(classifyConsensus("Sell")).toBe("Sell");
  });

  it("reads the headline label, not the breakdown that follows it", () => {
    // The breakdown names all three ratings; only the headline is the claim.
    expect(classifyConsensus("Hold (4 Buy, 18 Hold, 3 Sell)")).toBe("Hold");
    expect(classifyConsensus("Moderate Buy — 18 buy, 6 hold, 1 sell")).toBe("Buy");
    expect(classifyConsensus("Strong Buy | 30 Buy, 2 Hold")).toBe("Buy");
  });

  it("understands the house styles that mean the same thing", () => {
    expect(classifyConsensus("Neutral")).toBe("Hold");
    expect(classifyConsensus("Market Perform")).toBe("Hold");
    expect(classifyConsensus("Equal-weight")).toBe("Hold");
    expect(classifyConsensus("Overweight")).toBe("Buy");
    expect(classifyConsensus("Outperform")).toBe("Buy");
    expect(classifyConsensus("Underperform")).toBe("Sell");
  });

  it("keeps hyphenated labels intact rather than splitting them apart", () => {
    expect(classifyConsensus("Under-weight")).toBe("Sell");
    expect(classifyConsensus("Equal weight rating")).toBe("Hold");
  });

  it("is case and whitespace insensitive", () => {
    expect(classifyConsensus("  hOLd  ")).toBe("Hold");
  });

  it("refuses to guess when nothing is recognisable", () => {
    expect(classifyConsensus("Not found")).toBeNull();
    expect(classifyConsensus("")).toBeNull();
    expect(classifyConsensus(null)).toBeNull();
    expect(classifyConsensus(undefined)).toBeNull();
    expect(classifyConsensus("covered by 12 analysts")).toBeNull();
  });

  it("refuses to guess when the text is genuinely ambiguous", () => {
    // No headline label at all — just a tally. Picking one would be inventing
    // a consensus the source never stated.
    expect(classifyConsensus("12 buy 12 hold")).toBeNull();
  });
});
