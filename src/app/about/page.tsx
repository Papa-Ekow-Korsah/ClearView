import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "About | ClearView" };

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-8">
      <h2 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 mb-3 pb-2 border-b border-line">
        {title}
      </h2>
      <div className="text-sm text-ink-2 leading-[1.8] space-y-3">
        {children}
      </div>
    </section>
  );
}

export default function AboutPage() {
  return (
    <main className="flex-1">
      <div className="max-w-2xl mx-auto w-full px-5 sm:px-7 py-10">
        <h1 className="text-2xl font-semibold tracking-tight mb-2">
          About Clear<span className="text-accent">View</span>
        </h1>
        <p className="text-[15px] text-ink-2 leading-relaxed mb-9">
          A personal equity research tool. One user, one job: turn a ticker
          into a research note I&apos;d actually act on.
        </p>

        <Section title="Why this exists">
          <p>
            Most free research tools give you either raw numbers with no
            interpretation, or someone else&apos;s conclusions with no numbers.
            Neither is useful when you&apos;re trying to form your own view.
            ClearView pulls real fundamentals and recent news for any ticker,
            puts them side-by-side with the closest comparables, and generates
            a structured note — thesis, catalysts, risks — grounded in that
            data.
          </p>
          <p>
            The division of labour matters: every figure in a note comes from
            market data (Finnhub), and the AI (Claude) is only allowed to
            write narrative around it. It can&apos;t invent a P/E ratio,
            because it never produces numbers — it reads them.
          </p>
        </Section>

        <Section title="How I invest">
          <p>
            I look for asymmetric setups — situations where the downside is
            bounded and understood, and the upside isn&apos;t priced in. In
            practice that pushes me toward small and mid-caps, where coverage
            is thin and mispricing survives longer, and toward
            catalyst-driven positions: an earnings inflection, a product
            cycle, a regulatory decision with a date on it.
          </p>
          <p>
            That style shapes the tool. Notes lead with the thesis (what the
            market under-appreciates), catalysts are time-bounded wherever
            possible, and the risk section is required to be the honest bear
            case rather than boilerplate. If a note can&apos;t articulate why
            the setup is asymmetric, that itself is the answer.
          </p>
        </Section>

        <Section title="How it's built">
          <p>
            Next.js (App Router) with TypeScript and Tailwind, deployed on
            Vercel. Postgres (Neon) stores the watchlist and a full snapshot
            of every generated note, so reopening old research never re-spends
            an API call. All external API keys live server-side — the browser
            only ever talks to this app&apos;s own endpoints, which are
            rate-limited and auth-gated.
          </p>
          <p>
            Analysis generation uses Claude with structured outputs: the
            response is schema-constrained JSON, so the app never parses
            free-form model text. Fundamentals, peer selection, and quotes
            come from Finnhub; five-day price history for the watchlist comes
            from Yahoo Finance.
          </p>
          <p>
            Anyone can read the{" "}
            <Link href="/history" className="text-accent hover:underline">
              research archive
            </Link>
            ; generating new analyses and editing the watchlist requires the
            owner login.
          </p>
        </Section>

        <Section title="What this is not">
          <p>
            This is a personal research tool, not investment advice. The notes
            are AI-assisted synthesis of public data, produced for my own
            process — they can be wrong, stale, or incomplete, and they know
            nothing about anyone&apos;s financial situation. Do your own
            research.
          </p>
        </Section>
      </div>
    </main>
  );
}
