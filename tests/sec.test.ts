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
