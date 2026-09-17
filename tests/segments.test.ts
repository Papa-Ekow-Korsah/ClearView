import { describe, expect, it } from "vitest";
import { verifySegments } from "@/lib/company-profile";
import type { SegmentFigure } from "@/types/company-profile";

// Shaped like NVIDIA's MD&A segment table, flattened to text.
const MDNA = [
  "Revenue by Reportable Segments",
  "Compute & Networking $ 193,479 $ 116,193 $ 77,286 67 %",
  "Graphics 22,459 14,304 8,155 57 %",
  "Our Data Center segment revenue was $180.2 billion for the fiscal year, driven by Blackwell.",
].join("\n");
const tenK = { business: null, mdna: MDNA, url: "https://sec.gov/x" };

const seg = (over: Partial<SegmentFigure>): SegmentFigure => ({
  name: "Compute & Networking",
  amountAsStated: "$193,479",
  amount: 193479,
  period: "Fiscal 2026",
  quote: "Compute & Networking $ 193,479 $ 116,193 $ 77,286 67 %",
  source: "mdna",
  ...over,
});

const graphics = seg({
  name: "Graphics",
  amountAsStated: "22,459",
  amount: 22459,
  quote: "Graphics 22,459 14,304 8,155 57 %",
});

describe("verifySegments", () => {
  it("keeps figures read off the filing, largest first", () => {
    const out = verifySegments([graphics, seg({})], tenK);
    expect(out.map((s) => s.name)).toEqual(["Compute & Networking", "Graphics"]);
    expect(out[0].sourceUrl).toBe("https://sec.gov/x");
  });

  it("drops a figure that isn't in its quote, even when the quote is real", () => {
    // The quote exists in the filing, but $150,000 was never stated in it.
    const invented = seg({ amountAsStated: "$150,000", amount: 150000 });
    expect(verifySegments([invented, graphics], tenK)).toEqual([]);
  });

  it("drops a figure whose number doesn't match what's stated", () => {
    // A 10x misread of a correctly quoted figure.
    const misread = seg({ amount: 1934790 });
    expect(verifySegments([misread, graphics], tenK)).toEqual([]);
  });

  it("drops a quote that isn't in the filing", () => {
    const fake = seg({
      name: "Automotive",
      amountAsStated: "$5,100",
      amount: 5100,
      quote: "Automotive $ 5,100 $ 3,000 $ 2,100 70 % across all markets",
    });
    expect(verifySegments([seg({}), graphics, fake], tenK).map((s) => s.name)).toEqual([
      "Compute & Networking",
      "Graphics",
    ]);
  });

  it("refuses to chart figures on different scales", () => {
    // $180.2 billion next to 22,459 (millions) would make the shares nonsense.
    const billions = seg({
      name: "Data Center",
      amountAsStated: "$180.2 billion",
      amount: 180.2,
      quote: "Our Data Center segment revenue was $180.2 billion for the fiscal year, driven by Blackwell.",
    });
    expect(verifySegments([billions, graphics], tenK)).toEqual([]);
  });

  it("keeps only the dominant period", () => {
    const otherYear = seg({ name: "Graphics", period: "Fiscal 2025", amountAsStated: "14,304", amount: 14304, quote: "Graphics 22,459 14,304 8,155 57 %" });
    const out = verifySegments([seg({}), graphics, otherYear], tenK);
    expect(out.every((s) => s.period === "Fiscal 2026")).toBe(true);
  });

  it("returns nothing rather than a one-bar chart", () => {
    expect(verifySegments([seg({})], tenK)).toEqual([]);
  });
});
