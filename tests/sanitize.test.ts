import { describe, expect, it } from "vitest";
import { stripJsonNoise } from "@/lib/anthropic";

describe("stripJsonNoise", () => {
  it("strips trailing JSON garbage observed in the wild", () => {
    expect(
      stripJsonNoise('every name listed.”} }} } }} }}}}} } } } } }')
    ).toBe("every name listed.");
  });

  it("keeps clean prose untouched", () => {
    expect(stripJsonNoise("A solid quarter.")).toBe("A solid quarter.");
  });

  it("keeps a legitimate trailing quote when no braces follow", () => {
    expect(stripJsonNoise('management called it "transformative"')).toBe(
      'management called it "transformative"'
    );
  });

  it("keeps interior braces (e.g. code or set notation) intact", () => {
    expect(stripJsonNoise("the {X, Y} segmentation held up")).toBe(
      "the {X, Y} segmentation held up"
    );
  });
});
