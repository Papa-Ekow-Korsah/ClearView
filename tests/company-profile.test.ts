import { describe, expect, it } from "vitest";
import {
  figuresSupported,
  findQuote,
  normalizeForMatch,
  openingOf,
  verifyParagraph,
} from "@/lib/company-profile";
import { toLines, sliceItem, extractSections } from "@/lib/tenk";

const REAL =
  "We make our branded beverage products available to consumers through our network of independent bottling partners, distributors, wholesalers and retailers.";

const docs = [
  { id: "10k-business", text: `Item 1. Business\n${REAL}\nOther text.` },
  { id: "10q-mdna", text: "Net operating revenues grew 6% to $12,472 million in the first quarter of 2026." },
  { id: "release1", text: "Revenue was $81.6 billion, up 85% from a year ago, for the quarter ended April 26, 2026." },
];

describe("findQuote", () => {
  it("returns the document a real passage is in", () => {
    expect(findQuote(REAL, "10k-business", docs)).toBe("10k-business");
  });

  it("rejects a paraphrase — the whole point of the check", () => {
    const invented =
      "We distribute our beverage products worldwide via independent bottling partners and retail distributors.";
    expect(findQuote(invented, "10k-business", docs)).toBeNull();
  });

  it("rejects a passage too short to prove anything", () => {
    expect(findQuote("our network", "10k-business", docs)).toBeNull();
  });

  it("attributes a real passage to where it was actually found, not where it was cited", () => {
    // Citing the 10-K for a sentence from the earnings release is a
    // bookkeeping slip, not an invention.
    expect(findQuote("Revenue was $81.6 billion, up 85% from a year ago", "10k-business", docs)).toBe("release1");
  });

  it("tolerates curly quotes, dashes and line breaks", () => {
    const d = [{ id: "a", text: "We expanded the company’s reach —\nmaterially — during the year." }];
    expect(findQuote("We expanded the company's reach - materially - during the year.", "a", d)).toBe("a");
  });
});

describe("figuresSupported", () => {
  const quote = "Net operating revenues grew 6% to $12,472 million in the first quarter of 2026.";

  it("accepts figures copied from the passage", () => {
    expect(figuresSupported("Revenue grew 6% to $12,472 million in the first quarter of 2026.", [quote])).toBe(true);
  });

  it("accepts a restated unit — $12.5 billion from $12,472 million", () => {
    expect(figuresSupported("Quarterly revenue reached about $12.5 billion.", [quote])).toBe(true);
  });

  it("rejects a figure the passage doesn't contain", () => {
    // Plausible, specific, and invented: the exact thing long prose invites.
    expect(figuresSupported("Revenue grew 9% to $12,472 million.", [quote])).toBe(false);
  });

  it("rejects a computed figure the documents never state", () => {
    expect(figuresSupported("That was roughly $3.1 billion more than a year earlier.", [quote])).toBe(false);
  });

  it("requires years to match exactly", () => {
    expect(figuresSupported("In the first quarter of 2025 revenue grew 6%.", [quote])).toBe(false);
  });

  it("ignores numbers that are names, not figures", () => {
    // Form types, quarters and product codes aren't claims.
    expect(figuresSupported("The 10-K and Q1 results cover the H100 and Microsoft 365 E5.", [quote])).toBe(true);
  });

  it("allows small bare counts but not small percentages", () => {
    expect(figuresSupported("The company runs 4 operating segments.", [quote])).toBe(true);
    expect(figuresSupported("Margins improved 4% in the period.", [quote])).toBe(false);
  });
});

describe("verifyParagraph", () => {
  it("keeps a paragraph whose passages are real and whose figures are in them", () => {
    const out = verifyParagraph(
      {
        text: "Coca-Cola's revenue grew 6% to $12,472 million in the first quarter of 2026.",
        evidence: [{ quote: "Net operating revenues grew 6% to $12,472 million in the first quarter of 2026.", sourceId: "10q-mdna" }],
      },
      docs
    );
    expect(out?.evidence).toHaveLength(1);
  });

  it("drops a paragraph with no real passage", () => {
    expect(
      verifyParagraph(
        { text: "The company is growing quickly.", evidence: [{ quote: "The company grew very quickly across all of its markets.", sourceId: "10q-mdna" }] },
        docs
      )
    ).toBeNull();
  });

  it("drops a paragraph whose figure only exists in a fabricated passage", () => {
    // One real passage and one invented one; the invented one is discarded,
    // so the figure it would have supported is left unsupported.
    const out = verifyParagraph(
      {
        text: "Revenue grew 6%, and management expects 20% growth next year.",
        evidence: [
          { quote: "Net operating revenues grew 6% to $12,472 million in the first quarter of 2026.", sourceId: "10q-mdna" },
          { quote: "Management expects revenue growth of 20% in the next fiscal year.", sourceId: "release1" },
        ],
      },
      docs
    );
    expect(out).toBeNull();
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

describe("section start selection", () => {
  it("takes the first real heading when the item number repeats later", () => {
    // Microsoft's 10-K labels its closing "Available Information" block
    // "Item 1" again. Searching from the end returned that tail instead of
    // the business description — a 7k slice where the real one is 44k.
    // Paragraph count matters: a bare "Item N" only counts as a heading when
    // real prose follows rather than more contents rows, so the body has to be
    // as long here as it is in a filing.
    const body = Array.from(
      { length: 6 },
      (_, i) => `<p>${`The real description of what this company does, part ${i}. `.repeat(6)}</p>`
    ).join("");
    const html = `
      <p>Item 1</p><p>Business</p>
      ${body}
      <p>Item 1</p><p>AVAILABLE INFORMATION</p>
      <p>${"Our Internet address is www.example.com and we post filings there. ".repeat(6)}</p>
      <p>Item 1A. Risk Factors</p>
      <p>Risks follow here.</p>`;
    const section = sliceItem(toLines(html), "1", "business", "1A", "risk\\s*factors", 1);
    expect(section).toContain("The real description of what this company does");
    // The tail must be inside the section, not the start of it.
    expect(section!.indexOf("The real description")).toBeLessThan(section!.indexOf("Internet address"));
  });
});

describe("headings split across inline spans", () => {
  it("matches a title whose words are broken by stray spaces", () => {
    // Real shapes from Oracle's and Microsoft's 10-Ks: "R isk Factors",
    // "B USINESS". The text is right; only the spacing is broken.
    const body = Array.from(
      { length: 4 },
      (_, i) => `<p>${`Oracle provides products and services, part ${i}. `.repeat(6)}</p>`
    ).join("");
    const html = `<p>ITEM 1. B USINESS</p>${body}<p>Item 1A. R isk Factors</p><p>Risks.</p>`;
    const section = sliceItem(toLines(html), "1", "business", "1A", "risk\\s*factors", 1);
    expect(section).toContain("Oracle provides products and services");
  });
});

describe("openingOf — filing boilerplate", () => {
  it("skips the investor-relations paragraph every 10-K carries", () => {
    const business = [
      "Item 1. Business",
      `Our Internet address is www.example.com. At our Investor Relations website we make available free of charge a variety of information for investors, ${"including many useful things. ".repeat(6)}`,
      `We design and manufacture industrial pumps for water treatment plants, ${"selling them through a global distributor network. ".repeat(5)}`,
    ].join("\n");
    const opening = openingOf(business);
    expect(opening).toContain("We design and manufacture industrial pumps");
    expect(opening).not.toContain("Internet address");
  });

  it("skips bulleted list items and safe-harbour language", () => {
    const business = [
      "Item 1. Business",
      `• Our annual report on Form 10-K, quarterly reports on Form 10-Q, and current reports ${"and any amendments thereto. ".repeat(6)}`,
      `This report contains forward-looking statements within the meaning of the Private Securities Litigation Reform Act ${"of 1995 and related provisions. ".repeat(4)}`,
      `We operate retail grocery stores across twelve states, ${"serving roughly four million customers each week. ".repeat(5)}`,
    ].join("\n");
    expect(openingOf(business)).toContain("We operate retail grocery stores");
  });
});
