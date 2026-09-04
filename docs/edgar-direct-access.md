# Direct EDGAR access

**Status: fixed locally and verified. Production unverified until deployed.**
Originally diagnosed 2026-08-13; root cause found 2026-09-04.

## The actual cause: a URL in the User-Agent

SEC's edge rejects any `User-Agent` containing a URL or bare domain. Our UA
was:

```
ClearView personal research tool (contact via github.com/Papa-Ekow-Korsah/ClearView)
```

so **every EDGAR request failed, from every network** — not only from Vercel.
Measured 2026-09-04 against `data.sec.gov/submissions/CIK0000047217.json`
from a residential IP:

| User-Agent | Result |
|---|---|
| `...(contact via github.com/...)` | **403** |
| `ClearView research tool (github.com/x/y)` | **403** |
| `ClearView research tool https://github.com/x/y` | **403** |
| `ClearView research tool contact via github.com` | **403** |
| `ClearView personal research tool` | **200** |
| `ClearView Research paakorsah1@gmail.com` | **200** |
| `ClearView` | **200** |

The discriminator is the URL, not the presence of a contact. A plain
descriptive name passes; a name plus an email passes and is what SEC's own
developer guidance asks for.

**Never put a URL in this header.** `lib/edgar.ts` documents this at the
`SEC_UA` definition. Set `SEC_CONTACT_EMAIL` to append a contact address.

## What the earlier diagnosis got right and wrong

The 2026-08-13 production probe recorded 403s from Vercel on both hosts in
22–96ms and concluded an IP-level block on Vercel's shared egress, adding
that "adding a contact email to the User-Agent will not fix this."

That conclusion was wrong about the cause we could control — three of its
four probes used a UA containing a contact URL, which fails from anywhere.
Its fourth probe used `ClearView/2.0`, which contains no URL and still 403'd,
so an IP-level block on Vercel may *also* have been real at that time.

**Therefore: local access is now proven working; production is not yet
proven.** Re-run a real analysis in production after deploying and check
whether `guidanceSource` is non-null in the stored note. If it is still null
there, the Vercel egress block is genuine and separate, and the proxy options
below apply.

## What now works (verified locally, 2026-09-04)

Verified against live filings:

- `getRecentEarningsReleases("HPQ", 2)` returns the 8-Ks filed 2026-08-26 and
  2026-05-27 with full press-release text.
- Guidance is extracted from the filing rather than recalled: HPQ Q4 FY2026
  EPS guidance of `$0.74 to $0.84` (GAAP) came out of the document, and
  revenue range is honestly `Not disclosed` because HP doesn't guide revenue.
- The guidance-delivery scorecard scores the prior release's promise against
  the latest release's result. HPQ: GAAP EPS guided `$0.47 to $0.63`,
  delivered `$0.71` — beat.
- AAPL returns an empty scorecard with an explanation, because Apple states
  no numeric guidance in its press release. This is the correct outcome, not
  a failure.

## Why Finnhub-sourced SEC data still works

The verified balance sheet, margins and cash flow come from Finnhub's
`financials-reported` endpoint, which fetches EDGAR from *their*
infrastructure. It was never affected.

## Fallbacks if production is still blocked

1. **Cloudflare Worker proxy** (free tier, ~20 lines). Unverified — Cloudflare
   egress may also be blocked. Requires a Cloudflare account.
2. **Pre-cache from an unblocked machine** into Postgres; production reads the
   cache. Manual, and only covers tickers fetched ahead of time.
3. **Leave it.** The web-search `GUIDANCE` field now renders as a cited
   fallback when the filing can't be reached, so production degrades to a
   sourced third-party figure rather than to nothing.

Even while blocked the app never invented guidance — the prompt forces
"Not disclosed". That mattered: two AI-recalled CROX runs six weeks apart
produced **$1.19B–$1.22B** and **$1.10B–$1.14B** for the same quarter. Same
company, same question, different fabricated numbers.
