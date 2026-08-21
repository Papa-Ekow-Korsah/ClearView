import { describe, expect, it } from "vitest";
import { htmlToText, pickPressRelease } from "@/lib/edgar";

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
