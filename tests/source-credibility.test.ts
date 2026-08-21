import { describe, expect, it } from "vitest";
import {
  assessSource,
  blockedDomains,
  domainOf,
  isBlocked,
  weakestTier,
} from "@/lib/source-credibility";

describe("domainOf", () => {
  it("normalises host and strips www", () => {
    expect(domainOf("https://WWW.Reuters.com/markets/x")).toBe("reuters.com");
  });

  it("returns empty string for junk", () => {
    expect(domainOf("not a url")).toBe("");
  });
});

describe("assessSource", () => {
  it("treats regulators and official statistics as primary", () => {
    expect(assessSource("https://www.sec.gov/Archives/edgar/x.htm").tier).toBe("primary");
    expect(assessSource("https://fiscaldata.treasury.gov/api/x").tier).toBe("primary");
  });

  it("treats established financial press as established", () => {
    for (const u of [
      "https://www.reuters.com/business/x",
      "https://apnews.com/article/x",
      "https://www.cnbc.com/2026/01/01/x.html",
      "https://finance.yahoo.com/news/x",
    ]) {
      expect(assessSource(u).tier, u).toBe("established");
    }
  });

  it("treats newswires as established, since they carry company statements verbatim", () => {
    expect(assessSource("https://www.businesswire.com/news/x").tier).toBe("established");
  });

  it("flags contributor platforms and algorithmic sites as caution", () => {
    for (const u of [
      "https://seekingalpha.com/article/x",
      "https://www.fool.com/investing/x",
      "https://simplywall.st/stocks/x",
      "https://www.benzinga.com/x",
    ]) {
      expect(assessSource(u).tier, u).toBe("caution");
    }
  });

  it("defaults unknown domains to caution rather than assuming credibility", () => {
    const out = assessSource("https://some-random-stock-blog.example/post");
    expect(out.tier).toBe("caution");
    expect(out.note).toMatch(/unconfirmed/i);
  });

  it("matches subdomains of recognised publishers", () => {
    expect(assessSource("https://markets.ft.com/data/x").tier).toBe("established");
  });

  it("does not let a lookalike domain inherit a tier", () => {
    expect(assessSource("https://reuters.com.fake-site.ru/x").tier).toBe("caution");
  });

  it("explains every verdict", () => {
    for (const u of ["https://sec.gov/x", "https://reuters.com/x", "https://unknown.test/x"]) {
      expect(assessSource(u).note.length).toBeGreaterThan(20);
    }
  });
});

describe("blocking", () => {
  it("excludes user-generated and social sources outright", () => {
    expect(isBlocked("https://www.reddit.com/r/stocks/x")).toBe(true);
    expect(isBlocked("https://stocktwits.com/x")).toBe(true);
    expect(isBlocked("https://old.reddit.com/r/x")).toBe(true);
  });

  it("does not block legitimate publishers", () => {
    expect(isBlocked("https://www.reuters.com/x")).toBe(false);
  });

  it("exposes the list for the search request", () => {
    expect(blockedDomains()).toContain("reddit.com");
    expect(blockedDomains().length).toBeGreaterThan(5);
  });
});

describe("weakestTier", () => {
  it("reports the weakest link in a citation set", () => {
    expect(weakestTier(["https://sec.gov/a", "https://reuters.com/b"])).toBe("established");
    expect(weakestTier(["https://reuters.com/b", "https://unknown.test/c"])).toBe("caution");
    expect(weakestTier(["https://sec.gov/a"])).toBe("primary");
  });

  it("treats an empty set as primary so it never invents a warning", () => {
    expect(weakestTier([])).toBe("primary");
  });
});
