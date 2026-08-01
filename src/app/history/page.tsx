import type { Metadata } from "next";
import Link from "next/link";
import { listAnalyses } from "@/lib/db/queries";
import { isAuthenticated } from "@/lib/auth/session";
import {
  HistoryLedger,
  type LedgerRow,
} from "@/components/history/HistoryLedger";
import type { ResearchNote } from "@/types/analysis";
import type { ResearchNoteV2 } from "@/types/analysis-v2";

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

  const ledgerRows: LedgerRow[] = rows.map((r) => {
    const note = r.note as ResearchNote | ResearchNoteV2;
    const isV2 = "formatVersion" in note && note.formatVersion === 2;
    const v2 = isV2 ? (note as ResearchNoteV2) : null;
    return {
      id: r.id,
      ticker: r.ticker,
      companyName: r.companyName,
      createdAt: r.createdAt.toISOString(),
      signal: v2?.ai?.signal ?? null,
      verified: v2?.secFinancials != null,
    };
  });

  return (
    <main className="flex-1">
      <div className="max-w-3xl mx-auto w-full px-5 sm:px-7 py-7">
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
              {filter
                ? `No saved notes for ${filter}.`
                : "No research notes yet."}
            </p>
            <p className="text-xs text-ink-3">
              {authed
                ? "Run an analysis from the Research page to start the archive."
                : "The owner hasn't published any research yet."}
            </p>
          </div>
        ) : (
          <HistoryLedger
            rows={ledgerRows}
            authed={authed}
            filtered={Boolean(filter)}
          />
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
