import { describe, expect, it } from "vitest";
import { extractSecFinancials } from "@/lib/sec";
import type { ReportedFinancials } from "@/lib/finnhub";

// Trimmed from a real Finnhub financials-reported response for NVDA.
const item = (concept: string, value: number, label = "") => ({
  concept,
  label,
  unit: "usd",
  value,
});

const fixture: ReportedFinancials = {
  data: [
    {
      year: 2027,
      quarter: 1,
      form: "10-Q",
      startDate: "2026-01-26 00:00:00",
      endDate: "2026-04-26 00:00:00",
      filedDate: "2026-05-28 00:00:00",
      report: {
        bs: [
          item("us-gaap_CashAndCashEquivalentsAtCarryingValue", 13_237e6),
          item("us-gaap_DebtSecuritiesCurrent", 37_098e6),
          item("us-gaap_EquitySecuritiesFvNi", 30_237e6),
          item("us-gaap_Assets", 259_474e6),
          item("us-gaap_AssetsCurrent", 150_995e6),
          item("us-gaap_LiabilitiesCurrent", 43_884e6),
          item("us-gaap_DebtCurrent", 1_000e6),
          item("us-gaap_LongTermDebtNoncurrent", 7_470e6),
          item("us-gaap_Liabilities", 64_000e6),
          item("us-gaap_StockholdersEquity", 195_474e6),
        ],
        ic: [
          item("us-gaap_Revenues", 81_615e6),
          item("us-gaap_GrossProfit", 61_157e6),
          item("us-gaap_OperatingIncomeLoss", 53_536e6),
          item("us-gaap_NetIncomeLoss", 58_321e6),
          item("us-gaap_EarningsPerShareDiluted", 2.39),
        ],
        cf: [
          item("us-gaap_NetCashProvidedByUsedInOperatingActivities", 50_344e6),
          item("us-gaap_PaymentsToAcquireProductiveAssets", 1_757e6),
          item("us-gaap_PaymentsForRepurchaseOfCommonStock", 19_312e6),
          item("us-gaap_PaymentsOfDividends", 243e6),
        ],
      },
    },
    {
      year: 2026,
      quarter: 1,
      form: "10-Q",
      startDate: "2025-01-27 00:00:00",
      endDate: "2025-04-27 00:00:00",
      filedDate: "2025-05-29 00:00:00",
      report: {
        bs: [],
        ic: [item("us-gaap_Revenues", 44_062e6)],
        cf: [],
      },
    },
  ],
};

describe("extractSecFinancials", () => {
  const sec = extractSecFinancials(fixture)!;

  it("extracts the latest filing's identity", () => {
    expect(sec.form).toBe("10-Q");
    expect(sec.fiscalPeriod).toBe("Q1 FY2027");
    expect(sec.endDate).toBe("2026-04-26");
  });

  it("extracts balance sheet figures and computes net debt", () => {
    expect(sec.balanceSheet.cash).toBe(13_237e6);
    expect(sec.balanceSheet.shortTermInvestments).toBe(67_335e6); // debt + equity securities
    expect(sec.balanceSheet.totalAssets).toBe(259_474e6);
    expect(sec.balanceSheet.totalLiabilities).toBe(64_000e6);
    expect(sec.balanceSheet.longTermDebt).toBe(7_470e6);
    // 8.47B debt − 80.57B liquid = deeply net cash
    expect(sec.balanceSheet.netDebt).toBe(8_470e6 - 80_572e6);
  });

  it("extracts income statement and YoY revenue growth from the prior-year quarter", () => {
    expect(sec.incomeStatement.revenue).toBe(81_615e6);
    expect(sec.incomeStatement.revenueYoYPct).toBeCloseTo(85.2, 0);
    expect(sec.incomeStatement.epsDiluted).toBe(2.39);
  });

  it("computes free cash flow from operating CF minus capex", () => {
    expect(sec.cashFlow.freeCashFlow).toBe(50_344e6 - 1_757e6);
    expect(sec.cashFlow.buybacks).toBe(19_312e6);
  });

  it("returns null when there are no filings", () => {
    expect(extractSecFinancials({ data: [] })).toBeNull();
  });

  it("falls back to computing liabilities from total minus equity", () => {
    const alt: ReportedFinancials = {
      data: [
        {
          ...fixture.data[0],
          report: {
            bs: [
              item("us-gaap_LiabilitiesAndStockholdersEquity", 100e9),
              item("us-gaap_StockholdersEquity", 60e9),
            ],
            ic: [item("us-gaap_RevenueFromContractWithCustomerExcludingAssessedTax", 5e9)],
            cf: [],
          },
        },
      ],
    };
    const out = extractSecFinancials(alt)!;
    expect(out.balanceSheet.totalLiabilities).toBe(40e9);
    expect(out.incomeStatement.revenue).toBe(5e9);
  });
});

// ── period handling ──────────────────────────────────────────────
//
// Modelled on the real HPQ payload. A 10-Q's income statement and cash flow
// are year-to-date for every quarter after the first: HP's Q2 FY2026 row
// reports $28.846B over six months, while HP's own press release states
// $14.4B for the quarter. Q1 YTD is $14.438B, so the quarter is the
// difference — $14.408B, which matches the release to the rounded digit.
const hpFiling = (
  year: number,
  quarter: number,
  startDate: string,
  endDate: string,
  revenue: number,
  operatingCF: number,
  netIncome = revenue / 20
) => ({
  year,
  quarter,
  form: "10-Q",
  startDate: `${startDate} 00:00:00`,
  endDate: `${endDate} 00:00:00`,
  filedDate: `${endDate} 00:00:00`,
  report: {
    bs: [item("us-gaap_Assets", 42_900e6), item("us-gaap_StockholdersEquity", -144e6)],
    ic: [
      item("us-gaap_Revenues", revenue),
      item("us-gaap_NetIncomeLoss", netIncome),
      item("us-gaap_EarningsPerShareDiluted", 1.05),
    ],
    cf: [
      item("us-gaap_NetCashProvidedByUsedInOperatingActivities", operatingCF),
      item("us-gaap_PaymentsToAcquirePropertyPlantAndEquipment", 400e6),
    ],
  },
});

const hpq: ReportedFinancials = {
  data: [
    hpFiling(2026, 2, "2025-11-01", "2026-04-30", 28_846e6, 1_309e6, 995e6),
    hpFiling(2026, 1, "2025-11-01", "2026-01-31", 14_438e6, 380e6, 450e6),
    hpFiling(2025, 2, "2024-11-01", "2025-04-30", 26_720e6, 410e6, 800e6),
    hpFiling(2025, 1, "2024-11-01", "2025-01-31", 13_500e6, 370e6, 400e6),
  ],
};

describe("extractSecFinancials — year-to-date filings", () => {
  const sec = extractSecFinancials(hpq)!;

  it("reduces a six-month filing to the quarter by subtracting the prior YTD", () => {
    // Not 28.846B, which is what reading the row at face value would give.
    expect(sec.incomeStatement.revenue).toBe(14_408e6);
    expect(sec.periodBasis).toBe("quarter-derived");
    expect(sec.periodMonths).toBe(3);
  });

  it("reduces cash flow the same way, so margins can't mix periods", () => {
    expect(sec.cashFlow.operatingCF).toBe(1_309e6 - 380e6);
    expect(sec.cashFlow.capex).toBe(0); // 400e6 − 400e6
    expect(sec.cashFlow.freeCashFlow).toBe(929e6);
  });

  it("compares like with like on YoY, quarter against quarter", () => {
    // Q2 FY2026 quarter 14.408B vs Q2 FY2025 quarter (26.72 − 13.5) = 13.22B
    expect(sec.incomeStatement.revenueYoYPct).toBeCloseTo(8.98, 1);
  });

  it("refuses to derive EPS, which is a weighted average and doesn't subtract", () => {
    expect(sec.incomeStatement.epsDiluted).toBeNull();
  });

  it("leaves the balance sheet alone — it is point-in-time, not a flow", () => {
    expect(sec.balanceSheet.totalAssets).toBe(42_900e6);
    expect(sec.balanceSheet.equity).toBe(-144e6);
  });

  it("still labels a derived quarter as that quarter", () => {
    expect(sec.fiscalPeriod).toBe("Q2 FY2026");
  });
});

describe("extractSecFinancials — Q1 needs no adjustment", () => {
  const sec = extractSecFinancials({ data: [hpq.data[1], hpq.data[3]] })!;

  it("takes a three-month filing at face value", () => {
    expect(sec.incomeStatement.revenue).toBe(14_438e6);
    expect(sec.periodBasis).toBe("quarter");
    expect(sec.periodMonths).toBe(3);
  });

  it("keeps as-reported EPS, which is genuinely the quarter's", () => {
    expect(sec.incomeStatement.epsDiluted).toBe(1.05);
  });
});

describe("extractSecFinancials — cumulative with no predecessor", () => {
  // NVDA's history has real gaps: Q2 FY2024 is present with no Q1 FY2024.
  const orphan: ReportedFinancials = {
    data: [hpq.data[0]], // Q2 FY2026 alone, six months
  };
  const sec = extractSecFinancials(orphan)!;

  it("keeps the cumulative figure rather than inventing a quarter", () => {
    expect(sec.incomeStatement.revenue).toBe(28_846e6);
    expect(sec.periodBasis).toBe("cumulative");
    expect(sec.periodMonths).toBe(6);
  });

  it("refuses to call six months a quarter", () => {
    expect(sec.fiscalPeriod).not.toContain("Q2");
    expect(sec.fiscalPeriod).toBe("FY2026 year-to-date (6mo)");
  });

  it("shows no YoY rather than comparing a half-year to a quarter", () => {
    expect(sec.incomeStatement.revenueYoYPct).toBeNull();
  });
});

describe("extractSecFinancials — mismatched fiscal-year start", () => {
  it("won't difference against a filing that starts elsewhere", () => {
    // A restated or rescoped prior filing must not be silently subtracted.
    const mismatched: ReportedFinancials = {
      data: [
        hpq.data[0],
        hpFiling(2026, 1, "2025-08-01", "2026-01-31", 14_438e6, 380e6),
      ],
    };
    const sec = extractSecFinancials(mismatched)!;
    expect(sec.periodBasis).toBe("cumulative");
    expect(sec.incomeStatement.revenue).toBe(28_846e6);
  });
});

describe("extractSecFinancials — EPS quirks", () => {
  it("treats an exact-zero EPS as missing rather than asserting it", () => {
    // Real case: KO's Q1 FY2026 tags both basic and diluted EPS as 0 against
    // roughly $0.91 actual. Zero under a verified badge is a false claim.
    const zeroEps: ReportedFinancials = {
      data: [
        {
          ...hpq.data[1], // Q1, three months, so EPS is otherwise kept
          report: {
            ...hpq.data[1].report,
            ic: [item("us-gaap_Revenues", 12_472e6), item("us-gaap_EarningsPerShareDiluted", 0)],
          },
        },
      ],
    };
    expect(extractSecFinancials(zeroEps)!.incomeStatement.epsDiluted).toBeNull();
  });

  it("keeps a negative EPS, which is a real result", () => {
    const lossEps: ReportedFinancials = {
      data: [
        {
          ...hpq.data[1],
          report: {
            ...hpq.data[1].report,
            ic: [item("us-gaap_Revenues", 1e9), item("us-gaap_EarningsPerShareDiluted", -0.42)],
          },
        },
      ],
    };
    expect(extractSecFinancials(lossEps)!.incomeStatement.epsDiluted).toBe(-0.42);
  });
});
