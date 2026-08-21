# Direct EDGAR access is blocked from Vercel

**Status: blocked in production, works everywhere else. Needs a proxy.**
Tested 2026-08-13.

## What happens

`lib/edgar.ts` retrieves earnings press releases (8-K Item 2.02) so guidance
figures can be extracted from the filed document instead of recalled by the
model. It works from a residential IP and fails in production.

SEC returns **403 "Request Rate Threshold Exceeded"** to every request from
Vercel, in 22–96ms — far too fast to be a rate limit we caused. A diagnostic
deployed to production probed four combinations:

| Target | User-Agent | Result |
|---|---|---|
| `www.sec.gov/files/company_tickers.json` | descriptive, with contact URL | 403 in 96ms |
| `www.sec.gov/files/company_tickers.json` | plain `ClearView/2.0` | 403 in 41ms |
| `data.sec.gov/submissions/CIK...json` | descriptive | 403 in 44ms |
| `www.sec.gov/Archives/.../index.json` | descriptive | 403 in 22ms |

Both hosts, both User-Agent styles, first request of the session. This is an
**IP-level block on Vercel's shared egress**, not a per-caller rate limit and
not a User-Agent policy rejection.

Practical consequence: **adding a contact email to the User-Agent will not
fix this.** SEC's developer policy does ask for one, and it is worth doing if
we ever get unblocked, but it is not the cause here.

## Why Finnhub-sourced SEC data still works

The verified balance sheet, margins and cash flow come from Finnhub's
`financials-reported` endpoint, which fetches EDGAR from *their*
infrastructure. Only our direct document fetches are affected.

## Current behaviour (safe)

`getLatestEarningsRelease()` returns null, `guidanceSource` is stored as
null, and the prompt instructs the model to write **"Not disclosed"** for
every guidance figure rather than substitute a remembered value. Verified in
production: a CROX analysis returned `Not disclosed` for revenue range, EPS
and gross margin.

This is a real improvement over the previous behaviour even while blocked —
the app no longer invents guidance. It just doesn't yet show any.

Why that matters: two AI-recalled CROX runs six weeks apart produced
**$1.19B–$1.22B** and **$1.10B–$1.14B** for the same quarter's guidance.
Same company, same question, different fabricated numbers.

## Options to unblock

1. **Cloudflare Worker proxy** (free tier, ~20 lines). Route SEC requests
   through it. Unverified — Cloudflare egress may also be blocked; would take
   about ten minutes to find out. Requires a Cloudflare account.
2. **Pre-cache from an unblocked machine.** A script run locally fetches
   filings for watchlist tickers into Postgres; production reads the cache.
   No new account, but it is manual and only covers tickers fetched ahead of
   time.
3. **Different host for the app.** Disproportionate for one feature.
4. **Leave it.** Guidance shows "Not disclosed" in production. Safe, honest,
   and loses a genuinely useful field.

Option 1 first, falling back to option 2, is the recommended order.
