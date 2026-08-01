/**
 * Ticker validation. ClearView is US-first: the data sources behind it
 * (Finnhub free tier, SEC EDGAR) cover US listings only, so exchange-suffixed
 * symbols get an honest explanation rather than a misleading format error.
 * See docs/uk-coverage.md.
 */

const US_TICKER = /^[A-Z]{1,6}$/;
const EXCHANGE_SUFFIXED = /^[A-Z0-9]{1,6}\.[A-Z]{1,3}$/;

/** Common Yahoo/Finnhub exchange suffixes, for a specific error message. */
const EXCHANGE_NAMES: Record<string, string> = {
  L: "London Stock Exchange",
  DE: "Frankfurt",
  PA: "Euronext Paris",
  AS: "Euronext Amsterdam",
  MI: "Borsa Italiana",
  MC: "Madrid",
  ST: "Stockholm",
  SW: "Swiss Exchange",
  TO: "Toronto",
  V: "TSX Venture",
  AX: "Australian Securities Exchange",
  HK: "Hong Kong",
  SS: "Shanghai",
  SZ: "Shenzhen",
  T: "Tokyo",
  NS: "India (NSE)",
  BO: "India (BSE)",
};

export interface TickerValidation {
  ok: boolean;
  ticker: string;
  error?: string;
}

export function validateTicker(raw: string): TickerValidation {
  const ticker = String(raw ?? "")
    .trim()
    .toUpperCase();

  if (US_TICKER.test(ticker)) return { ok: true, ticker };

  if (EXCHANGE_SUFFIXED.test(ticker)) {
    const suffix = ticker.split(".")[1];
    const exchange = EXCHANGE_NAMES[suffix];
    return {
      ok: false,
      ticker,
      error: `ClearView currently covers US-listed stocks only, so ${ticker}${
        exchange ? ` (${exchange})` : ""
      } isn't supported. Verified financials come from SEC filings, which non-US listings don't have. If the company has a US listing or ADR, try that symbol instead.`,
    };
  }

  return {
    ok: false,
    ticker,
    error: "Ticker must be 1-6 letters, e.g. AAPL.",
  };
}
