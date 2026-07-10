# ClearView v2 — Build Spec

## Context
ClearView is a personal equity research tool I built as a single-file HTML/JS app using the Anthropic API and Finnhub. It works, but I want to turn it into a proper deployed web app I can show people — a portfolio piece that reflects how I actually think about investing (asymmetric returns, small/mid-cap focus, thesis-driven).

This is still a personal tool — I'm the only user — but it must be publicly accessible at a URL, look professional, and be architected in a way that a technical reviewer would take seriously.

## Non-negotiables
- **API keys must live server-side only.** The current version exposes the Anthropic and Finnhub keys in the browser. That has to go — all external API calls must be proxied through a backend the client cannot inspect.
- **Publicly accessible URL**, deployable from a git repo, with a free-tier-friendly hosting setup.
- **Clean, modern UI.** Not enterprise-bland, not toy-looking. Confident and readable. Dark mode by default is fine.
- **Mobile-usable**, not just desktop.

## Stack
Recommend and pick a sensible modern stack. Next.js on Vercel is the safe default and I'm happy with it unless you have a clear reason to go elsewhere. Use TypeScript. Use Tailwind for styling. Pick a lightweight database that's free-tier friendly for the persistence features below (e.g. Vercel Postgres, Turso, or Supabase — your call).

## Core feature: Ticker analysis
User enters a ticker. The app pulls fundamentals and recent news from Finnhub (or a better free-tier data source if you find one), sends it to the Anthropic API, and returns a structured research note with these sections:

1. **Investment thesis** — the core bull case in 3–5 sentences. What does the market not appreciate? Why might this be asymmetric?
2. **Catalysts** — specific upcoming events, product launches, earnings expectations, macro triggers, regulatory decisions. Time-bounded where possible.
3. **Risks** — the honest bear case. Execution risk, competitive risk, macro sensitivity, balance sheet issues, valuation risk. Not generic disclaimers.
4. **Peer comparables** — pull 3–5 relevant peers, show a side-by-side table of key metrics (revenue growth, gross margin, operating margin, P/E or EV/EBITDA, market cap, net debt/EBITDA). The goal is relative performance context, not a full DCF. AI should also write a 2–3 sentence commentary on how the company stacks up against its peers.

Skip: full DCF, dividend analysis unless relevant to the thesis, ESG boilerplate.

**Model choice:** use Claude Sonnet or Opus for analysis generation — pick the current best price/quality trade-off. Do not hardcode a model that will be deprecated; make it a config value.

## Feature: Watchlist with live prices
- User can add tickers to a personal watchlist.
- Show live-ish prices (Finnhub free tier is fine, poll every 30–60s while the tab is open).
- Show day change (%), and a small sparkline of the last 5 trading days.
- Clicking a ticker takes you into the analysis view.

## Feature: Saved analyses / history
- Every time an analysis is generated, save it (ticker, timestamp, full note).
- A "History" view listing past analyses, newest first, filterable by ticker.
- Clicking one reopens the note. No need to re-generate.
- Include a delete option.

## Feature: About page
Simple one-pager explaining:
- What ClearView is and what problem it solves for me
- My investing style (asymmetric returns, small/mid-cap focus, catalyst-driven)
- The stack and architecture, briefly
- A note that this is a personal tool, not investment advice

Write this page in a voice that reflects a serious retail investor who thinks clearly — not marketing copy.

## Auth
Since it's personal but public, gate the app behind a simple auth so only I can generate analyses and use my API quota. Simplest thing that works: a single-user password login, or magic-link email. Public visitors can see the About page and a demo/read-only analysis, but cannot generate new ones or edit the watchlist.

## Quality bar
- Loading states for every async action.
- Sensible error handling — if Finnhub or Anthropic fails, tell me what happened, not "something went wrong."
- Rate limiting on the analysis endpoint so I don't accidentally burn through my quota.
- Basic unit tests for the API routes and the peer-selection logic.
- README that explains setup, env vars, deployment.

## What I'll provide
- Screenshots of the current ClearView so you can carry over the aesthetic direction I liked.
- API keys for Anthropic and Finnhub (via `.env.local`, never committed).
- A domain name once you're ready to deploy.

## What to do first
1. Read the current ClearView HTML file (I'll drop it in the repo root as `legacy-clearview.html`).
2. Propose the stack and file structure in a short plan before writing code.
3. Wait for my sign-off, then scaffold.
4. Build in this order: auth → backend API routes (Finnhub + Anthropic proxies) → analysis view → watchlist → history → About → polish → deploy.

Ask me questions when the spec is ambiguous. Don't guess on the visual direction — reference the screenshots.
