import { NextResponse } from "next/server";
import { listAllCalls } from "@/lib/db/queries";
import { getDailyCloses } from "@/lib/history";
import {
  BENCHMARK_TICKER,
  buildTrackRecord,
  computeOutcome,
  type Call,
  type CallOutcome,
  type Conviction,
  type Signal,
} from "@/lib/track-record";
import type { ResearchNote } from "@/types/analysis";
import type { ResearchNoteV2 } from "@/types/analysis-v2";

/**
 * The accountability ledger: every call ever generated, scored against the
 * benchmark. Public (history is public) and costs zero AI credits — it's
 * computation over stored notes plus free price history.
 */
export async function GET() {
  const rows = await listAllCalls();

  // Only v2 notes carry a signal; v1 notes predate it and aren't scoreable.
  const calls: Call[] = [];
  for (const row of rows) {
    const note = row.note as ResearchNote | ResearchNoteV2;
    if (!("formatVersion" in note) || note.formatVersion !== 2) continue;
    const v2 = note as ResearchNoteV2;
    const entryPrice = v2.snapshot?.price;
    if (typeof entryPrice !== "number" || !Number.isFinite(entryPrice)) continue;

    calls.push({
      id: row.id,
      ticker: row.ticker,
      companyName: row.companyName,
      signal: v2.ai.signal as Signal,
      conviction: v2.ai.conviction as Conviction,
      generatedAt: v2.generatedAt ?? row.createdAt.toISOString(),
      entryPrice,
      verified: v2.secFinancials != null,
      deleted: row.deletedAt != null,
    });
  }

  if (calls.length === 0) {
    return NextResponse.json(buildTrackRecord([]));
  }

  // One price series per distinct ticker, plus the benchmark. Cached 1h.
  const tickers = [...new Set(calls.map((c) => c.ticker))];
  const [benchCloses, ...seriesList] = await Promise.all([
    getDailyCloses(BENCHMARK_TICKER),
    ...tickers.map((t) => getDailyCloses(t)),
  ]);
  const byTicker = new Map(tickers.map((t, i) => [t, seriesList[i] ?? []]));

  const outcomes: CallOutcome[] = calls.map((call) =>
    computeOutcome(call, byTicker.get(call.ticker) ?? [], benchCloses)
  );

  return NextResponse.json(buildTrackRecord(outcomes));
}
