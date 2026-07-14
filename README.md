# ClearView

A personal equity research tool. Enter a ticker; get a structured research note — investment thesis, time-bounded catalysts, honest risks, and a peer comparables table — built from real market data with AI-written narrative.

Live app: _(added after deploy)_

## How it works

The division of labour is the core design decision:

- **Finnhub** provides every number: quotes, fundamentals, peer lists, metrics, news.
- **Claude** (via structured outputs) writes only narrative — thesis, catalysts, risks, peer commentary. It reads the numbers; it never produces them, so it can't hallucinate a P/E.
- **Postgres (Neon)** snapshots every generated note in full, so reopening old research never re-spends an API call, plus the watchlist and rate-limit counters.

Public visitors can read the research archive (`/history`, `/analysis/[id]`) and the About page. Generating analyses and editing the watchlist require the owner login. All third-party API keys live server-side only.

## Stack

- Next.js 16 (App Router) + TypeScript + Tailwind CSS 4
- Neon Postgres + Drizzle ORM
- Anthropic SDK (structured outputs; model configurable via env)
- Auth: single-user bcrypt password + signed httpOnly JWT cookie (jose)
- Vitest

## Local setup

Prereqs: Node 20+ and a git clone of this repo.

```sh
npm install
cp .env.example .env.local
```

Fill in `.env.local`:

| Variable | Where to get it |
|---|---|
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| `ANTHROPIC_MODEL` | Optional; defaults to `claude-sonnet-5` |
| `FINNHUB_API_KEY` | [finnhub.io](https://finnhub.io/dashboard) — free tier |
| `DATABASE_URL` | [neon.tech](https://neon.tech) — create a free project, copy the connection string |
| `APP_PASSWORD_HASH` | `node -e "console.log(require('bcryptjs').hashSync('your-password', 12))"` — **escape every `$` as `\$` and quote the value** (Next.js expands `$VAR` in env files and silently mangles the hash otherwise) |
| `SESSION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |

Create the tables, then run:

```sh
npx drizzle-kit push
npm run dev
```

Open http://localhost:3000 — you'll land on the public history page; sign in from the nav to generate research.

## Tests & checks

```sh
npm test            # vitest: peer selection, sanitizer, API validation
npm run typecheck   # tsc --noEmit
npm run lint
```

## Deploying to Vercel (from scratch)

1. **Push to GitHub**: create an empty repo on github.com, then
   `git remote add origin <repo-url> && git push -u origin main`.
2. **Create a Vercel account** at [vercel.com/signup](https://vercel.com/signup) — sign up with GitHub so repo import is one click.
3. **Import the project**: Vercel dashboard → *Add New → Project* → select the repo. Framework preset auto-detects Next.js; no build settings to change.
4. **Add environment variables** on the import screen (or later under *Settings → Environment Variables*): all six from the table above. Paste the bcrypt hash **without** the `\$` escaping here — Vercel's env UI stores values verbatim; the escaping is only needed in `.env` files.
5. **Deploy.** First build takes a couple of minutes.
6. **Point the DB at production**: no change needed — the same Neon `DATABASE_URL` works locally and in prod. (Alternatively use Vercel's Neon integration under *Storage* and it will inject `DATABASE_URL` for you.)
7. Custom domain (optional): *Settings → Domains*.

## Operational notes

- **Rate limit**: analysis generation is capped at 10/hour (DB-backed, survives serverless cold starts). Change in `src/lib/rate-limit.ts`.
- **Watchlist**: capped at 20 tickers; prices poll every 45s only while the tab is visible; 5-day sparklines come from Yahoo's chart API (Finnhub candles are paid-tier).
- **Model**: swap `ANTHROPIC_MODEL` any time; nothing else references a model name.
- **Password rotation**: regenerate the hash (command above), update the env var, redeploy. Sessions sign out after 30 days or when `SESSION_SECRET` changes.

## Disclaimer

Personal research tool. AI-assisted synthesis of public data — not investment advice.
