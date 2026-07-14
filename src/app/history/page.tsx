import type { Metadata } from "next";
import Link from "next/link";
import { listAnalyses } from "@/lib/db/queries";
import { isAuthenticated } from "@/lib/auth/session";
import { DeleteAnalysisButton } from "@/components/history/DeleteAnalysisButton";

export const metadata: Metadata = { title: "Research history | ClearView" };

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker } = await searchParams;
  const filter = ticker?.trim().toUpperCase() || undefined;

  const [rows, authed] = await Promise.all([
    listAnalyses(filter),
    isAuthenticated(),
  ]);

  // Distinct tickers for the filter chips (unfiltered list keeps chips stable)
  const allRows = filter ? await listAnalyses() : rows;
  const tickers = [...new Set(allRows.map((r) => r.ticker))].sort();

  return (
    <main className="flex-1">
      <div className="max-w-2xl mx-auto w-full px-5 sm:px-7 py-7">
        <div className="flex items-baseline justify-between mb-1.5 flex-wrap gap-2">
          <h1 className="text-xl font-semibold tracking-tight">
            Research history
          </h1>
          <p className="text-xs text-ink-3">
            {rows.length} note{rows.length === 1 ? "" : "s"}
            {filter ? ` · ${filter}` : ""}
          </p>
        </div>
        <p className="text-[13px] text-ink-2 mb-5">
          Every generated note, snapshotted in full — reopening never re-runs
          the analysis.
        </p>

        {tickers.length > 1 && (
          <div className="flex gap-1.5 flex-wrap mb-5">
            <FilterChip href="/history" active={!filter}>
              All
            </FilterChip>
            {tickers.map((t) => (
              <FilterChip
                key={t}
                href={`/history?ticker=${t}`}
                active={filter === t}
              >
                {t}
              </FilterChip>
            ))}
          </div>
        )}

        {rows.length === 0 ? (
          <div className="bg-surface border border-line rounded-card py-12 text-center">
            <p className="text-sm text-ink-2 mb-1">
              {filter ? `No saved notes for ${filter}.` : "No research notes yet."}
            </p>
            <p className="text-xs text-ink-3">
              {authed
                ? "Run an analysis from the Research page to start the archive."
                : "The owner hasn't published any research yet."}
            </p>
          </div>
        ) : (
          <div className="bg-surface border border-line rounded-card overflow-hidden">
            {rows.map((row) => (
              <div
                key={row.id}
                className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0 hover:bg-surface-2/60 transition-colors"
              >
                <Link
                  href={`/analysis/${row.id}`}
                  className="flex items-baseline gap-3 flex-1 min-w-0"
                >
                  <span className="text-[13px] font-mono font-semibold w-14 shrink-0">
                    {row.ticker}
                  </span>
                  <span className="text-[13px] text-ink-2 truncate">
                    {row.companyName}
                  </span>
                  <span className="text-[11px] text-ink-3 ml-auto shrink-0 font-mono">
                    {row.createdAt.toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </Link>
                {authed && <DeleteAnalysisButton id={row.id} />}
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}

function FilterChip({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-1 rounded-full text-xs font-mono font-medium border transition-colors ${
        active
          ? "bg-accent text-white border-accent"
          : "border-line-2 text-ink-2 bg-surface hover:border-accent hover:text-accent"
      }`}
    >
      {children}
    </Link>
  );
}
