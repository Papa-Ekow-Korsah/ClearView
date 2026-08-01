# UK / international coverage — research notes

**Status: parked. ClearView is deliberately US-first for now.**
Findings below were tested against live APIs on 2026-08-01. Pick this up
before attempting any non-US support — several of the blockers are not
obvious.

## Why ClearView is US-first

Not a product decision so much as an economic one. The verified-data
advantage rests on **SEC EDGAR being free, public domain, and structured**.
No equivalent exists for the UK, and commercial global fundamentals were
quoted at **~$3,500/month**, which is out of scope for a personal tool.

So the honest framing: US coverage is deep and verifiable; everything else
is either unavailable or unverified, and the UI must say so rather than
imply equal rigour.

## What was tested

### Finnhub free tier: no UK data at all

Every endpoint returns **403 Forbidden** for LSE-suffixed symbols
(`TSCO.L`, `RR.L`, `AZN.L`, `BARC.L`) — including plain quotes. This is a
hard block, not a fundamentals gap.

### ADRs: partial data, zero filings — this was the live trust hole

US-listed UK companies (`AZN`, `SHEL`, `BP`, `RYCEY`) **do** return profile,
quote, metrics and peers from Finnhub. But `financials-reported` returns
**0 filings** for all of them — Finnhub's endpoint indexes 10-K/10-Q and
does not surface the 20-F that foreign private issuers file.

Consequence before the coverage banner shipped: typing `AZN` produced a
complete, confident six-tab analysis whose entire Earnings tab was
AI-generated, distinguished only by a small grey tag. Fixed by the coverage
banner, but the underlying data gap remains.

### Yahoo `fundamentals-timeseries`: a real free path for UK

Undocumented, no auth, no key:

```
https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/TSCO.L
  ?symbol=TSCO.L&type=annualTotalRevenue,annualNetIncome,annualTotalAssets
  &period1=<unix>&period2=<unix>
```

Returned genuine Tesco figures (revenue £65.3B → £73.7B FY23–FY26, net
income £737M → £1,787M, total assets).

Note `quoteSummary` (the more commonly cited endpoint) returns **401
Unauthorized** — it now requires a crumb/cookie. `fundamentals-timeseries`
does not. Use the latter.

### The structural finding: UK reports half-yearly

Quarterly requests return **balance-sheet items only** (`quarterlyTotalDebt`,
`quarterlyCashAndCashEquivalents`, `quarterlyTotalAssets`,
`quarterlyStockholdersEquity`). No `quarterlyTotalRevenue`,
`quarterlyNetIncome`, `quarterlyOperatingIncome`, or cash flow — for either
Tesco or Rolls-Royce.

This is **not** a data gap. UK listing rules do not mandate quarterly
reporting; companies report half-yearly. There is no quarterly P&L to fetch.

## What would have to change for UK support

This is why UK support is a project, not a patch.

1. **The Earnings tab structure.** The current design is US-shaped: quarterly
   beat-vs-estimate cards, EPS surprise history, quarter-over-quarter
   segments. None of that exists for a UK issuer. A UK tab would need annual
   figures with half-yearly balance-sheet updates and no beat/miss cadence.
   Forcing UK data into the US layout would produce mostly empty panels.
2. **A third provenance tier.** Yahoo is an *aggregator*, not the filing.
   SEC data is as-reported and deep-linkable to EDGAR; Yahoo data is
   second-hand. It should not wear the same "✓ Verified" badge. Suggested
   tiers: **as-reported** (SEC) → **data provider** (Yahoo/Finnhub) →
   **AI-generated**.
3. **Peer selection has no free UK source.** Finnhub `/stock/peers` is
   unavailable for UK. The peer comparables table would degrade to
   AI-suggested peers — reintroducing exactly the unverified content the
   SEC work removed. Needs a real answer (sector-based screening?) before
   UK ships.
4. **A whole non-Finnhub data path.** Profile, quote and ratios all come
   from Finnhub today and none of it works for UK. Every one needs a Yahoo
   (or other) equivalent.
5. **Ticker validation.** Currently `^[A-Z]{1,6}$`, which rejects the dot in
   `TSCO.L`. Exchange-suffixed tickers now get an accurate "US-only" error;
   real support means parsing the suffix and routing by exchange.
6. **Currency handling — the sharp edge.** Yahoo returns LSE prices in
   **GBp (pence), not pounds**. Tesco reads as `483.70` meaning £4.84.
   Rendering that as `$483.70` is wrong twice over. Any UK support must
   carry currency through the whole render path, including the track record
   (whose returns are currency-agnostic percentages, so those are safe, but
   entry prices are not).

## Licensing

Worth keeping straight, because it decides what's viable if ClearView ever
becomes a product:

- **SEC / EDGAR** — public domain. Safe to redistribute commercially. This
  is the only cleanly-licensed data in the stack.
- **Finnhub free tier / Yahoo endpoints** — not licensed for commercial
  redistribution, and the Yahoo endpoints are undocumented and unofficial
  (they can break without notice). Fine for a personal tool; not a
  foundation for a paid product.

Leaning on SEC data is therefore simultaneously the accuracy play, the trust
play, and the licensing-clean play. That alignment is why US-first is the
right scope rather than merely a convenient one.
