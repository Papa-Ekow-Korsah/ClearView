import { describe, expect, it } from "vitest";
import { guidanceExcerpt, htmlToText, pickPressRelease } from "@/lib/edgar";

// Filenames below are the real ones observed on EDGAR for these filings.
describe("pickPressRelease", () => {
  const f = (name: string, size = "1000") => ({ name, size });

  it("picks the exhibit by name when it is recognisable (NVDA)", () => {
    const picked = pickPressRelease(
      [
        f("nvda-20260520.htm", "31418"),
        f("q1fy27pr.htm", "23091"),
        f("R1.htm", "38099"),
        f("0001045810-26-000051-index.html"),
      ],
      "nvda-20260520.htm"
    );
    // Cover page is excluded as primaryDoc; R-files are rendered views
    expect(picked).toBe("q1fy27pr.htm");
  });

  it("recognises ex-99 naming (SMCI)", () => {
    expect(
      pickPressRelease([f("smci-20260630.htm"), f("exhibit991_20260630.htm")], "smci-20260630.htm")
    ).toBe("exhibit991_20260630.htm");
  });

  it("recognises press-release naming (CROX)", () => {
    expect(
      pickPressRelease(
        [f("crox-20260730.htm"), f("croxq22026-pressrelease.htm")],
        "crox-20260730.htm"
      )
    ).toBe("croxq22026-pressrelease.htm");
  });

  it("falls back to the largest candidate when nothing is named obviously", () => {
    expect(
      pickPressRelease([f("a.htm", "500"), f("b.htm", "9000"), f("c.htm", "1200")], null)
    ).toBe("b.htm");
  });

  it("never returns rendered R-files or index pages", () => {
    expect(
      pickPressRelease([f("R2.htm", "90000"), f("0001-index.html", "80000")], null)
    ).toBeNull();
  });

  it("returns null when there are no html documents", () => {
    expect(pickPressRelease([f("data.xml"), f("chart.png")], null)).toBeNull();
  });
});

describe("htmlToText", () => {
  it("strips tags and decodes entities used in filings", () => {
    const html =
      "<html><body><p>Revenue&nbsp;of $1.2B</p><ul><li>&#8226; Outlook raised</li></ul></body></html>";
    expect(htmlToText(html)).toBe("Revenue of $1.2B • Outlook raised");
  });

  it("drops script and style content entirely", () => {
    const html = "<style>.x{color:red}</style><script>var a=1;</script><p>Guidance</p>";
    expect(htmlToText(html)).toBe("Guidance");
  });

  it("collapses the whitespace that filings are full of", () => {
    expect(htmlToText("<p>A</p>\n\n\n   <p>B</p>")).toBe("A B");
  });
});

describe("guidanceExcerpt", () => {
  const filler = (n: number) => "word ".repeat(n);

  it("returns short documents untouched", () => {
    const text = "A short press release with an Outlook section.";
    expect(guidanceExcerpt(text, 6_000)).toBe(text);
  });

  it("centres on the outlook section rather than the top of the document", () => {
    // Guidance sits well past the front matter, which is where a naive
    // head-truncation would leave the reader.
    const text = filler(3_000) + " Outlook Revenue is expected to be $91.0 billion. " + filler(3_000);
    const out = guidanceExcerpt(text, 1_000);
    expect(out).toContain("Outlook Revenue is expected to be $91.0 billion.");
    expect(out.length).toBeLessThanOrEqual(1_000);
  });

  it("keeps the run-up so the sentence introducing guidance survives", () => {
    const lead = "management provided the following. ";
    const text = filler(2_000) + lead + "Outlook for the third quarter of fiscal 2027. " + filler(2_000);
    expect(guidanceExcerpt(text, 2_000)).toContain(lead);
  });

  it("falls back to the head when no outlook section is present", () => {
    // Apple's releases have no guidance; truncating from the top is the only
    // sensible option, and must not throw or return nothing.
    const text = "START " + filler(5_000);
    const out = guidanceExcerpt(text, 500);
    expect(out.startsWith("START")).toBe(true);
    expect(out).toHaveLength(500);
  });
});
