import { describe, expect, it } from "vitest";
import { parseFacts } from "@/lib/websearch";

const get = (text: string, field: string) =>
  parseFacts(text).find((f) => f.field === field)!;

describe("parseFacts", () => {
  it("keeps a figure that carries a real source and tiers it", () => {
    const f = get(
      "REVENUE_CONSENSUS | $78.8 billion | https://www.reuters.com/business/nvidia-q1",
      "REVENUE_CONSENSUS"
    );
    expect(f.value).toBe("$78.8 billion");
    expect(f.domain).toBe("reuters.com");
    expect(f.tier).toBe("established");
    expect(f.note).toBeTruthy();
  });

  it("flags a weak source rather than discarding it", () => {
    const f = get(
      "PRICE_TARGET | $240 average | https://some-stock-blog.example/nvda",
      "PRICE_TARGET"
    );
    expect(f.value).toBe("$240 average");
    expect(f.tier).toBe("caution");
  });

  it("discards a figure with no source — an unattributable number is the problem being solved", () => {
    const f = get("REVENUE_CONSENSUS | $78.8 billion |", "REVENUE_CONSENSUS");
    expect(f.value).toBe("Not found");
    expect(f.url).toBeNull();
  });

  it("discards a figure whose source is a blocked user-generated site", () => {
    const f = get(
      "PRICE_TARGET | $500 | https://www.reddit.com/r/stocks/comments/x",
      "PRICE_TARGET"
    );
    expect(f.value).toBe("Not found");
    expect(f.url).toBeNull();
  });

  it("discards a figure whose third column isn't a URL", () => {
    const f = get("ANALYST_RATING | Strong Buy | according to analysts", "ANALYST_RATING");
    expect(f.value).toBe("Not found");
  });

  it("honours an explicit not-found", () => {
    const f = get("GUIDANCE | Not found |", "GUIDANCE");
    expect(f.value).toBe("Not found");
    expect(f.tier).toBeNull();
  });

  it("always returns every field, defaulting missing ones to not found", () => {
    const facts = parseFacts("REVENUE_CONSENSUS | $1B | https://reuters.com/x");
    expect(facts).toHaveLength(5);
    expect(facts.filter((f) => f.value === "Not found")).toHaveLength(4);
  });

  it("ignores commentary the model adds around the lines", () => {
    const facts = parseFacts(
      [
        "Here is what I found:",
        "ANALYST_RATING | Buy (18 of 24) | https://www.cnbc.com/quotes/NVDA",
        "",
        "Let me know if you need more.",
      ].join("\n")
    );
    expect(get2(facts, "ANALYST_RATING").value).toBe("Buy (18 of 24)");
    expect(get2(facts, "PRICE_TARGET").value).toBe("Not found");
  });

  it("keeps the first line when a field is repeated", () => {
    const f = get(
      [
        "PRICE_TARGET | $240 | https://www.reuters.com/a",
        "PRICE_TARGET | $999 | https://unknown.test/b",
      ].join("\n"),
      "PRICE_TARGET"
    );
    expect(f.value).toBe("$240");
  });

  it("ignores unknown field names", () => {
    expect(parseFacts("MADE_UP_FIELD | x | https://reuters.com/y")).toHaveLength(5);
  });
});

function get2(facts: ReturnType<typeof parseFacts>, field: string) {
  return facts.find((f) => f.field === field)!;
}
