import type {
  ReportedFinancialItem,
  ReportedFinancials,
} from "@/lib/finnhub";

/**
 * Extraction of key figures from as-reported SEC filings (via Finnhub
 * financials-reported). XBRL concept names vary by filer — some use custom
 * prefixed tags — so every figure is looked up through a candidate list of
 * us-gaap concept suffixes with a label-regex fallback. All values in USD.
 */

/**
 * What the income-statement and cash-flow figures actually cover.
 *
 *  - "quarter": the filing itself reported a three-month period (Q1 only,
 *    for most filers).
 *  - "quarter-derived": the filing reported year-to-date, and the quarter was
 *    obtained by subtracting the previous year-to-date filing. Both inputs
 *    are as-reported, so the result is arithmetic on filed data, not an
 *    estimate — but it is not a figure that appears verbatim in any filing.
 *  - "cumulative": year-to-date, and the previous filing needed to reduce it
 *    to a quarter wasn't available. The figures are honest but they are NOT
 *    a quarter, and must never be labelled as one.
 */
export type PeriodBasis = "quarter" | "quarter-derived" | "cumulative";

export interface SecFinancials {
  form: string; // "10-Q" | "10-K"
  fiscalPeriod: string; // e.g. "Q1 FY2027"
  endDate: string; // period end, YYYY-MM-DD
  filedDate: string;
  /** Months covered by incomeStatement and cashFlow (balance sheet is point-in-time). */
  periodMonths: number | null;
  periodBasis: PeriodBasis;
  balanceSheet: {
    cash: number | null;
    shortTermInvestments: number | null;
    totalCurrentAssets: number | null;
    totalAssets: number | null;
    totalCurrentLiabilities: number | null;
    totalLiabilities: number | null;
    equity: number | null;
    shortTermDebt: number | null;
    longTermDebt: number | null;
    /** debt minus cash & short-term investments; negative = net cash */
    netDebt: number | null;
  };
  incomeStatement: {
    revenue: number | null;
    revenueYoYPct: number | null; // vs same fiscal quarter prior year
    grossProfit: number | null;
    operatingIncome: number | null;
    netIncome: number | null;
    epsDiluted: number | null;
  };
  cashFlow: {
    operatingCF: number | null;
    capex: number | null;
    freeCashFlow: number | null;
    buybacks: number | null;
    dividends: number | null;
  };
}

type Report = { bs: ReportedFinancialItem[]; ic: ReportedFinancialItem[]; cf: ReportedFinancialItem[] };

function conceptSuffix(concept: string): string {
  const i = concept.indexOf("_");
  return i === -1 ? concept : concept.slice(i + 1);
}

/** First numeric value whose concept suffix matches a candidate (in order), else label regex. */
function find(
  items: ReportedFinancialItem[],
  candidates: string[],
  labelRe?: RegExp
): number | null {
  for (const cand of candidates) {
    const hit = items.find((it) => conceptSuffix(it.concept) === cand);
    if (hit && typeof hit.value === "number" && Number.isFinite(hit.value)) {
      return hit.value;
    }
  }
  if (labelRe) {
    const hit = items.find(
      (it) =>
        labelRe.test(it.label ?? "") &&
        typeof it.value === "number" &&
        Number.isFinite(it.value)
    );
    if (hit) return hit.value as number;
  }
  return null;
}

/** Sum of all matching concepts (for split line items like marketable securities). */
function sumAll(items: ReportedFinancialItem[], candidates: string[]): number | null {
  const values = items
    .filter((it) => candidates.includes(conceptSuffix(it.concept)))
    .map((it) => it.value)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

function extractRevenue(ic: ReportedFinancialItem[]): number | null {
  return find(
    ic,
    [
      "Revenues",
      "RevenueFromContractWithCustomerExcludingAssessedTax",
      "RevenueFromContractWithCustomerIncludingAssessedTax",
      "SalesRevenueNet",
    ],
    /^(total )?(net )?(revenue|sales)/i
  );
}

/**
 * Diluted EPS, treating an exact zero as missing.
 *
 * Some filers tag EPS as 0 in this feed — Coca-Cola's Q1 FY2026 reports both
 * basic and diluted as 0 against ~$0.91 actual, apparently a footnote-marked
 * tag the parser flattens. A genuine diluted EPS of exactly 0.00 is vanishingly
 * rare, while a zero artifact presented under a verified badge is a concrete
 * falsehood, so the trade favours saying nothing.
 */
function extractEps(ic: ReportedFinancialItem[]): number | null {
  const eps = find(ic, ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]);
  return eps === 0 ? null : eps;
}

// ── period handling ──────────────────────────────────────────────
//
// Finnhub's financials-reported mirrors the filing, and a 10-Q's income
// statement and cash flow are year-to-date for every quarter after the
// first. HP's Q2 FY2026 row, for instance, reports $28.85B of revenue over
// 2025-11-01 → 2026-04-30 — six months — while the company's own press
// release states $14.4B for the quarter. Reading the row at face value and
// calling it a quarter overstates every flow figure by up to 4x, under a
// "verified" badge. So the period is measured, and reduced to a quarter by
// subtracting the previous year-to-date filing where one exists.

type Filing = ReportedFinancials["data"][number];

const DAY = 86_400_000;

/** Months a filing's flow statements cover, from its own period bounds. */
export function periodMonths(filing: Filing): number | null {
  const start = Date.parse(String(filing.startDate).slice(0, 10));
  const end = Date.parse(String(filing.endDate).slice(0, 10));
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return Math.round((end - start) / DAY / 30.44);
}

/** Flow figures — additive across periods, unlike anything on the balance sheet. */
interface Flows {
  revenue: number | null;
  grossProfit: number | null;
  operatingIncome: number | null;
  netIncome: number | null;
  operatingCF: number | null;
  capex: number | null;
  buybacks: number | null;
  dividends: number | null;
}

function readFlows(report: Partial<Report> | undefined): Flows {
  const ic = report?.ic ?? [];
  const cf = report?.cf ?? [];
  return {
    revenue: extractRevenue(ic),
    grossProfit: find(ic, ["GrossProfit"]),
    operatingIncome: find(ic, ["OperatingIncomeLoss"]),
    netIncome: find(ic, ["NetIncomeLoss", "ProfitLoss"]),
    operatingCF: find(cf, [
      "NetCashProvidedByUsedInOperatingActivities",
      "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
    ]),
    capex: find(
      cf,
      [
        "PaymentsToAcquirePropertyPlantAndEquipment",
        "PaymentsToAcquireProductiveAssets",
        "PaymentsForCapitalImprovements",
      ],
      /purchases? of property|capital expenditure/i
    ),
    buybacks: find(cf, ["PaymentsForRepurchaseOfCommonStock"]),
    dividends: find(cf, ["PaymentsOfDividends", "PaymentsOfDividendsCommonStock"]),
  };
}

/** a − b, per field. A missing value on either side yields null, never a guess. */
function subtractFlows(a: Flows, b: Flows): Flows {
  const sub = (x: number | null, y: number | null) =>
    x === null || y === null ? null : x - y;
  return {
    revenue: sub(a.revenue, b.revenue),
    grossProfit: sub(a.grossProfit, b.grossProfit),
    operatingIncome: sub(a.operatingIncome, b.operatingIncome),
    netIncome: sub(a.netIncome, b.netIncome),
    operatingCF: sub(a.operatingCF, b.operatingCF),
    capex: sub(a.capex, b.capex),
    buybacks: sub(a.buybacks, b.buybacks),
    dividends: sub(a.dividends, b.dividends),
  };
}

/**
 * The filing covering this fiscal year up to the previous quarter — the one
 * whose year-to-date figures subtract cleanly. Matched on fiscal year and
 * quarter, and required to share a start date, so a restated or
 * differently-scoped filing can't be silently differenced against.
 */
function precedingYtd(filings: Filing[], filing: Filing): Filing | null {
  if (filing.quarter <= 1) return null;
  const start = String(filing.startDate).slice(0, 10);
  return (
    filings.find(
      (f) =>
        f.year === filing.year &&
        f.quarter === filing.quarter - 1 &&
        String(f.startDate).slice(0, 10) === start
    ) ?? null
  );
}

export interface QuarterFlows {
  flows: Flows;
  basis: PeriodBasis;
  /** Months the returned flows cover: 3 once derived, else the filed span. */
  months: number | null;
}

/**
 * Flow figures for one filing, reduced to a single quarter where the data
 * allows it. Exported for testing and reused for the year-ago comparison, so
 * a quarter is only ever compared against a quarter.
 */
export function quarterFlows(filings: Filing[], filing: Filing): QuarterFlows {
  const raw = readFlows(filing.report);
  const months = periodMonths(filing);

  // 3 months (or unknown-but-Q1) is already the quarter. The threshold is 4
  // rather than 3 because fiscal quarters run 13 or 14 weeks and round
  // unevenly; nothing legitimately lands between 4 and 5.
  if (months !== null && months <= 4) return { flows: raw, basis: "quarter", months };
  if (months === null && filing.quarter <= 1) {
    return { flows: raw, basis: "quarter", months: null };
  }

  const previous = precedingYtd(filings, filing);
  if (!previous) return { flows: raw, basis: "cumulative", months };

  return {
    flows: subtractFlows(raw, readFlows(previous.report)),
    basis: "quarter-derived",
    months: 3,
  };
}

export function extractSecFinancials(
  reported: ReportedFinancials
): SecFinancials | null {
  const filings = reported?.data ?? [];
  if (!filings.length) return null;
  const latest = filings[0];
  const { bs, ic, cf } = latest.report ?? ({} as Report);
  if (!bs?.length && !ic?.length) return null;

  const cash = find(
    bs ?? [],
    ["CashAndCashEquivalentsAtCarryingValue", "CashAndCashEquivalents"],
    /^cash and cash equivalents/i
  );
  const shortTermInvestments = sumAll(bs ?? [], [
    "ShortTermInvestments",
    "MarketableSecuritiesCurrent",
    "DebtSecuritiesCurrent",
    "EquitySecuritiesFvNi",
    "AvailableForSaleSecuritiesDebtSecuritiesCurrent",
  ]);
  const totalAssets = find(bs ?? [], ["Assets"]);
  const equity = find(bs ?? [], [
    "StockholdersEquity",
    "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest",
  ]);
  let totalLiabilities = find(bs ?? [], ["Liabilities"]);
  if (totalLiabilities === null) {
    const liabAndEquity = find(bs ?? [], ["LiabilitiesAndStockholdersEquity"]);
    if (liabAndEquity !== null && equity !== null) {
      totalLiabilities = liabAndEquity - equity;
    }
  }
  const shortTermDebt = find(
    bs ?? [],
    ["DebtCurrent", "LongTermDebtCurrent", "ShortTermBorrowings"],
    /current.*(debt|borrowings)|(debt|borrowings).*current/i
  );
  const longTermDebt = find(
    bs ?? [],
    ["LongTermDebtNoncurrent", "LongTermDebt"],
    /^long[- ]term debt/i
  );

  const debtTotal = (shortTermDebt ?? 0) + (longTermDebt ?? 0);
  const liquid = (cash ?? 0) + (shortTermInvestments ?? 0);
  const netDebt =
    shortTermDebt === null && longTermDebt === null && cash === null
      ? null
      : debtTotal - liquid;

  // Every flow figure comes from here, reduced to a single quarter where the
  // data allows. Reading ic/cf directly would reintroduce the year-to-date bug.
  const { flows, basis, months } = quarterFlows(filings, latest);
  const { revenue, operatingCF, capex } = flows;

  // YoY: same fiscal quarter, prior fiscal year — put through the identical
  // reduction, so a quarter is never compared against a half-year. If the
  // two sides don't end up covering the same span, no percentage is shown.
  let revenueYoYPct: number | null = null;
  const prior = filings.find(
    (f) => f.year === latest.year - 1 && f.quarter === latest.quarter
  );
  if (prior && revenue !== null) {
    const priorQ = quarterFlows(filings, prior);
    const comparable = priorQ.months === months;
    const prevRevenue = priorQ.flows.revenue;
    if (comparable && prevRevenue !== null && prevRevenue !== 0) {
      revenueYoYPct = ((revenue - prevRevenue) / Math.abs(prevRevenue)) * 100;
    }
  }

  const quarterLabel =
    latest.form === "10-K" || latest.quarter === 0
      ? `FY${latest.year}`
      : basis === "cumulative"
        ? // Not a quarter, so don't call it one. "Q2 FY2026" would be a false
          // claim about a six-month number.
          `FY${latest.year} year-to-date${months ? ` (${months}mo)` : ""}`
        : `Q${latest.quarter} FY${latest.year}`;

  return {
    form: latest.form,
    fiscalPeriod: quarterLabel,
    endDate: String(latest.endDate).slice(0, 10),
    filedDate: String(latest.filedDate).slice(0, 10),
    periodMonths: months,
    periodBasis: basis,
    balanceSheet: {
      cash,
      shortTermInvestments,
      totalCurrentAssets: find(bs ?? [], ["AssetsCurrent"]),
      totalAssets,
      totalCurrentLiabilities: find(bs ?? [], ["LiabilitiesCurrent"]),
      totalLiabilities,
      equity,
      shortTermDebt,
      longTermDebt,
      netDebt,
    },
    incomeStatement: {
      revenue,
      revenueYoYPct,
      grossProfit: flows.grossProfit,
      operatingIncome: flows.operatingIncome,
      netIncome: flows.netIncome,
      // Deliberately not derived. EPS is a weighted average over the period,
      // so YTD minus prior YTD is close to the quarter's EPS but not equal to
      // it, and an almost-right per-share figure under a verified badge is
      // worse than none. Verified quarterly EPS comes from the earnings
      // endpoint instead, which reports it directly.
      epsDiluted: basis === "quarter" ? extractEps(ic ?? []) : null,
    },
    cashFlow: {
      operatingCF,
      capex,
      freeCashFlow:
        operatingCF !== null && capex !== null ? operatingCF - capex : null,
      buybacks: flows.buybacks,
      dividends: flows.dividends,
    },
  };
}
