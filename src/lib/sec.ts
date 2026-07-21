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

export interface SecFinancials {
  form: string; // "10-Q" | "10-K"
  fiscalPeriod: string; // e.g. "Q1 FY2027"
  endDate: string; // period end, YYYY-MM-DD
  filedDate: string;
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

  const revenue = extractRevenue(ic ?? []);
  // YoY: same fiscal quarter, prior fiscal year
  let revenueYoYPct: number | null = null;
  const prior = filings.find(
    (f) => f.year === latest.year - 1 && f.quarter === latest.quarter
  );
  if (prior && revenue !== null) {
    const prevRevenue = extractRevenue(prior.report?.ic ?? []);
    if (prevRevenue !== null && prevRevenue !== 0) {
      revenueYoYPct = ((revenue - prevRevenue) / Math.abs(prevRevenue)) * 100;
    }
  }

  const operatingCF = find(cf ?? [], [
    "NetCashProvidedByUsedInOperatingActivities",
    "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations",
  ]);
  const capex = find(
    cf ?? [],
    [
      "PaymentsToAcquirePropertyPlantAndEquipment",
      "PaymentsToAcquireProductiveAssets",
      "PaymentsForCapitalImprovements",
    ],
    /purchases? of property|capital expenditure/i
  );

  const quarterLabel =
    latest.form === "10-K" || latest.quarter === 0
      ? `FY${latest.year}`
      : `Q${latest.quarter} FY${latest.year}`;

  return {
    form: latest.form,
    fiscalPeriod: quarterLabel,
    endDate: String(latest.endDate).slice(0, 10),
    filedDate: String(latest.filedDate).slice(0, 10),
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
      grossProfit: find(ic ?? [], ["GrossProfit"]),
      operatingIncome: find(ic ?? [], ["OperatingIncomeLoss"]),
      netIncome: find(ic ?? [], ["NetIncomeLoss", "ProfitLoss"]),
      epsDiluted: find(ic ?? [], ["EarningsPerShareDiluted", "EarningsPerShareBasicAndDiluted"]),
    },
    cashFlow: {
      operatingCF,
      capex,
      freeCashFlow:
        operatingCF !== null && capex !== null ? operatingCF - capex : null,
      buybacks: find(cf ?? [], ["PaymentsForRepurchaseOfCommonStock"]),
      dividends: find(cf ?? [], [
        "PaymentsOfDividends",
        "PaymentsOfDividendsCommonStock",
      ]),
    },
  };
}
