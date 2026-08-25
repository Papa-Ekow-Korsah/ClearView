/**
 * Source credibility tiering for web-retrieved facts.
 *
 * A hard whitelist was tempting but wrong: small and mid-caps — the focus of
 * this tool — are often covered only by second-tier outlets, so a whitelist
 * would return nothing precisely where help is most needed. Instead we
 * search broadly, block what is never acceptable, and label everything else
 * so the reader can weigh it.
 *
 * Judgement is deliberately conservative: anything unrecognised is
 * "caution". A source has to be earned onto the established list, not
 * assumed onto it.
 */

export type SourceTier = "primary" | "established" | "aggregator" | "caution";

/** Official and regulatory publishers — the document itself. */
const PRIMARY = [
  "sec.gov",
  "federalreserve.gov",
  "bls.gov",
  "bea.gov",
  "treasury.gov",
  "fiscaldata.treasury.gov",
  "stlouisfed.org",
  "ecb.europa.eu",
  "bankofengland.co.uk",
];

/**
 * Established financial press and newswires with editorial standards and
 * corrections policies. Newswires (Business Wire, PR Newswire, GlobeNewswire)
 * carry company statements verbatim, which makes them reliable for what a
 * company said, though not for independent analysis.
 */
const ESTABLISHED = [
  "reuters.com",
  "apnews.com",
  "bloomberg.com",
  "wsj.com",
  "ft.com",
  "cnbc.com",
  "barrons.com",
  "marketwatch.com",
  "investors.com",
  "morningstar.com",
  "economist.com",
  "nytimes.com",
  "washingtonpost.com",
  "theguardian.com",
  "bbc.co.uk",
  "bbc.com",
  "nasdaq.com",
  "businesswire.com",
  "prnewswire.com",
  "globenewswire.com",
  "finance.yahoo.com",
  "sp-global.com",
  "spglobal.com",
];

/**
 * Data aggregators: they compile market data and analyst estimates from
 * primary providers, but do no editorial reporting of their own and carry no
 * corrections policy.
 *
 * This tier exists because of what the data actually looks like. Analyst
 * consensus barely appears in the editorial press — a live MRVL retrieval
 * consulted fifteen pages and only two were established outlets. Lumping
 * these in with unknown blogs made the caution flag fire on almost every
 * citation, which trains the reader to ignore it. Separating them keeps the
 * warning meaningful for sources that genuinely warrant one.
 */
const AGGREGATOR = [
  "stockanalysis.com",
  "marketbeat.com",
  "investing.com",
  "tipranks.com",
  "zacks.com",
  "finviz.com",
  "public.com",
  "wallstreetzen.com",
  "stockinvest.us",
  "simplywall.st",
  "benzinga.com",
  "tradingview.com",
  "gurufocus.com",
  "macrotrends.net",
  "barchart.com",
  "stockopedia.com",
  "koyfin.com",
];

/**
 * Never usable as evidence: user-generated, social, and forum content. These
 * are excluded from the search itself rather than labelled, because no
 * caution tag makes a message board an acceptable citation for a financial
 * figure.
 */
const BLOCKED = [
  "reddit.com",
  "stocktwits.com",
  "x.com",
  "twitter.com",
  "facebook.com",
  "quora.com",
  "youtube.com",
  "tiktok.com",
  "medium.com",
  "substack.com",
];

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./i, "").toLowerCase();
  } catch {
    return "";
  }
}

function matches(domain: string, list: string[]): boolean {
  return list.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export interface SourceAssessment {
  domain: string;
  tier: SourceTier;
  /** Short reason shown on hover, so the tier isn't an unexplained verdict. */
  note: string;
}

export function assessSource(url: string): SourceAssessment {
  const domain = domainOf(url);
  if (!domain) {
    return { domain: "", tier: "caution", note: "Source URL could not be read." };
  }
  if (matches(domain, PRIMARY)) {
    return {
      domain,
      tier: "primary",
      note: "Official or regulatory publisher — the primary record.",
    };
  }
  if (matches(domain, ESTABLISHED)) {
    return {
      domain,
      tier: "established",
      note: "Established financial press or newswire with editorial standards.",
    };
  }
  if (matches(domain, AGGREGATOR)) {
    return {
      domain,
      tier: "aggregator",
      note: "Data aggregator — compiles figures from other providers rather than reporting them first-hand. Usually reliable for consensus data, but it is a secondary source.",
    };
  }
  return {
    domain,
    tier: "caution",
    note: "Not a recognised financial publisher or data provider — treat this figure as unconfirmed and check it against the company's own reporting.",
  };
}

/** Domains excluded from search entirely. */
export function blockedDomains(): string[] {
  return [...BLOCKED];
}

export function isBlocked(url: string): boolean {
  return matches(domainOf(url), BLOCKED);
}

/** Strongest first, so the weakest link in a set is the highest rank. */
const TIER_RANK: Record<SourceTier, number> = {
  primary: 0,
  established: 1,
  aggregator: 2,
  caution: 3,
};

/** Weakest tier present, for summarising a set of citations. */
export function weakestTier(urls: string[]): SourceTier {
  let weakest: SourceTier = "primary";
  for (const url of urls) {
    const { tier } = assessSource(url);
    if (TIER_RANK[tier] > TIER_RANK[weakest]) weakest = tier;
  }
  return weakest;
}
