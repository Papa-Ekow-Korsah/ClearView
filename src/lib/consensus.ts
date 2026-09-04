/**
 * Reading the street consensus out of a retrieved rating string.
 *
 * The verdict tab states, in words, what the analyst consensus is. That
 * sentence is only allowed to appear when it is demonstrably true, which
 * means it has to come from a retrieved, cited ANALYST_RATING value rather
 * than from the model's own signal. Anything this function can't confidently
 * classify returns null, and the claim simply isn't made.
 */

export type ConsensusDirection = "Buy" | "Hold" | "Sell";

const FAMILIES: { direction: ConsensusDirection; patterns: RegExp[] }[] = [
  {
    direction: "Buy",
    patterns: [
      /\bbuy\b/,
      /\boutperform\b/,
      /\bover-?weight\b/,
      /\baccumulate\b/,
      /\bpositive\b/,
    ],
  },
  {
    direction: "Hold",
    patterns: [
      /\bhold\b/,
      /\bneutral\b/,
      /\b(market|sector|peer)\s*perform\b/,
      /\bequal[-\s]?weight\b/,
      /\bin[-\s]?line\b/,
    ],
  },
  {
    direction: "Sell",
    patterns: [
      /\bsell\b/,
      /\bunder-?perform\b/,
      /\bunder-?weight\b/,
      /\breduce\b/,
      /\bnegative\b/,
    ],
  },
];

function matchFamily(text: string): ConsensusDirection | null {
  const hits = FAMILIES.filter((f) => f.patterns.some((p) => p.test(text)));
  return hits.length === 1 ? hits[0].direction : null;
}

/**
 * Classify a rating string like "Moderate Buy (18 Buy, 6 Hold, 1 Sell)".
 *
 * The headline label carries the assertion; everything after it is usually a
 * breakdown that names all three ratings and would otherwise match every
 * family at once. So the leading fragment is classified first, and the whole
 * string is only consulted when that fragment says nothing.
 */
export function classifyConsensus(raw: string | null | undefined): ConsensusDirection | null {
  if (!raw) return null;
  const text = raw.toLowerCase().trim();
  if (!text || text === "not found") return null;

  // Split on separators that introduce a breakdown. A bare hyphen is left
  // alone so "equal-weight" and "under-perform" survive intact.
  const head = text.split(/\s[—–-]\s|[(|:,/]/)[0].trim();
  return matchFamily(head) ?? matchFamily(text);
}
