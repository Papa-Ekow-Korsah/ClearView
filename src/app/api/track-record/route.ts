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
import type { ResearchNoteEtf } from "@/types/analysis-etf";

/**
 * The accountability ledger: every call ever generated, scored against the
 * benchmark. Public (history is public) and costs zero AI credits — it's
 * computation over stored notes plus free price history.
 */
export async function GET() {
  const rows = await listAllCalls();

  // v1 notes predate signals and aren't scoreable. Company (v2) and fund (v3)
  // notes both carry a signal, conviction and entry price, so a call on a
  // fund is held to exactly the same standard as one on a company.
  const calls: Call[] = [];
  for (const row of rows) {
    const note = row.note as ResearchNote | ResearchNoteV2 | ResearchNoteEtf;
    const version = "formatVersion" in note ? note.formatVersion : 1;
    if (version !== 2 && version !== 3) continue;

    const scored = note as ResearchNoteV2 | ResearchNoteEtf;
    const entryPrice = scored.snapshot?.price;
    if (typeof entryPrice !== "number" || !Number.isFinite(entryPrice)) continue;

    calls.push({
      id: row.id,
      ticker: row.ticker,
      companyName: row.companyName,
      signal: scored.ai.signal as Signal,
      conviction: scored.ai.conviction as Conviction,
      generatedAt: scored.generatedAt ?? row.createdAt.toISOString(),
      entryPrice,
      verified: version === 2 && (scored as ResearchNoteV2).secFinancials != null,
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
