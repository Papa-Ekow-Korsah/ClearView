import { NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/guard";
import { db } from "@/lib/db/client";
import { watchlist } from "@/lib/db/schema";
import { getQuote } from "@/lib/finnhub";

/**
 * Batched live quotes for the watchlist poll (every ~45s while the tab is
 * open). One request from the client fans out server-side with a 30s cache,
 * keeping Finnhub usage well under the 60/min free-tier cap.
 */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const rows = await db().select().from(watchlist);
  const quotes = await Promise.all(
    rows.map(async (r) => {
      try {
        const q = await getQuote(r.ticker);
        return {
          ticker: r.ticker,
          price: q.c || null,
          changePct: q.dp,
        };
      } catch {
        return { ticker: r.ticker, price: null, changePct: null };
      }
    })
  );

  return NextResponse.json({ quotes });
}
