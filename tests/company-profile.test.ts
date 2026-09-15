import { describe, expect, it } from "vitest";
import { normalizeForMatch, verifyClaim, openingOf } from "@/lib/company-profile";
import { toLines, sliceItem, extractSections } from "@/lib/tenk";
import type { Claim } from "@/types/company-profile";

const claim = (quote: string, source: Claim["source"] = "business"): Claim => ({
  point: "Some statement about the business.",
  quote,
  source,
});

// A sentence long enough to clear the minimum-length guard.
const REAL =
  "We make our branded beverage products available to consumers through our network of independent bottling partners, distributors, wholesalers and retailers.";

describe("verifyClaim", () => {
  const sources = { business: `Item 1. Business\n${REAL}\nOther text.`, mdna: null };

  it("accepts a quote that appears in the filing", () => {
    expect(verifyClaim(claim(REAL), sources)).toBe(true);
  });

  it("rejects a paraphrase — the whole point of the check", () => {
    // Plausible, on-topic, and nowhere in the document. This is exactly the
    // failure mode the feature exists to prevent.
    const invented =
      "We distribute our beverage products worldwide via independent bottling partners and retail distributors.";
    expect(verifyClaim(claim(invented), sources)).toBe(false);
  });

  it("rejects a fabricated sentence outright", () => {
    expect(
      verifyClaim(
        claim("The company expects revenue to double over the next three fiscal years."),
        sources
      )
    ).toBe(false);
  });

  it("rejects a quote too short to prove anything", () => {
    // "our network" appears verbatim, but proves nothing about the claim.
    expect(verifyClaim(claim("our network"), sources)).toBe(false);
  });

  it("tolerates curly quotes and dashes that filings use and models normalise", () => {
    const filing = { business: "We expanded the company’s reach — materially — during the year.", mdna: null };
    expect(
      verifyClaim(claim("We expanded the company's reach - materially - during the year."), filing)
    ).toBe(true);
  });

  it("tolerates line breaks inside a quoted sentence", () => {
    const filing = { business: "Revenue grew because of\nhigher concentrate pricing across markets.", mdna: null };
    expect(
      verifyClaim(claim("Revenue grew because of higher concentrate pricing across markets."), filing)
    ).toBe(true);
  });

  it("still verifies when the model names the wrong section", () => {
    // Mislabelling Item 1 as Item 7 is bookkeeping, not fabrication, and
    // shouldn't cost a genuine quote.
    const split = { business: null, mdna: REAL };
    expect(verifyClaim(claim(REAL, "business"), split)).toBe(true);
  });

  it("rejects everything when no source text was available", () => {
    expect(verifyClaim(claim(REAL), { business: null, mdna: null })).toBe(false);
  });
});

describe("normalizeForMatch", () => {
  it("collapses the differences that don't change meaning", () => {
    expect(normalizeForMatch("  The  Company’s\nplan  ")).toBe("the company's plan");
  });
});

describe("toLines / sliceItem", () => {
  const html = `
    <table><tr><td>Item 1.</td><td>Business</td><td>4</td></tr>
           <tr><td>Item 1A.</td><td>Risk Factors</td><td>12</td></tr></table>
    <p>Item 1. Business</p>
    <p>${"We design and sell things to customers around the world. ".repeat(6)}</p>
    <p>Item 1A. Risk Factors</p>
    <p>Things could go wrong in many ways.</p>`;

  it("keeps block elements on their own lines", () => {
    const lines = toLines(html);
    expect(lines).toContain("Item 1. Business");
    expect(lines).toContain("Item 1A. Risk Factors");
  });

  it("takes the body heading, not the table-of-contents row", () => {
    const section = sliceItem(toLines(html), "1", "business", "1A", "risk\\s*factors", 1);
    expect(section).toContain("We design and sell things");
    // The contents rows list page numbers; the real section must not include them.
    expect(section).not.toContain("12");
  });

  it("ignores a cross-reference buried in a sentence", () => {
    // Coca-Cola's 10-K really does contain this shape, and a flat-text search
    // would slice the document starting from it.
    const withRef = `
      <p>Item 1. Business</p>
      <p>${"Real business description here for the reader. ".repeat(6)}</p>
      <p>For more detail refer to Part I, Item 1. Business of this report for context.</p>
      <p>Item 1A. Risk Factors</p>`;
    const section = sliceItem(toLines(withRef), "1", "business", "1A", "risk\\s*factors", 1);
    expect(section?.startsWith("Item 1. Business")).toBe(true);
    expect(section).toContain("Real business description");
  });

  it("returns null rather than guessing when headings are absent", () => {
    const none = toLines("<p>Just a document with no item headings at all.</p>");
    expect(sliceItem(none, "1", "business", "1A", "risk\\s*factors")).toBeNull();
    expect(extractSections("<p>nothing here</p>").business).toBeNull();
  });
});

describe("openingOf", () => {
  it("returns the first substantial paragraph, skipping headings", () => {
    const business = `Item 1. Business\nOur Company\n${"NVIDIA pioneered accelerated computing to solve hard problems. ".repeat(4)}`;
    expect(openingOf(business)).toContain("NVIDIA pioneered accelerated computing");
  });

  it("returns null when there is no prose to quote", () => {
    expect(openingOf("Item 1. Business\nOverview")).toBeNull();
    expect(openingOf(null)).toBeNull();
  });
});
