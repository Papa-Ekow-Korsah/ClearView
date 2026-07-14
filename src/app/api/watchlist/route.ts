import { NextRequest, NextResponse } from "next/server";
import { desc, eq, inArray } from "drizzle-orm";
import { requireOwner } from "@/lib/auth/guard";
import { db } from "@/lib/db/client";
import { analyses, watchlist } from "@/lib/db/schema";
import { getProfile, isUnknownTicker, FinnhubError } from "@/lib/finnhub";
import { getFiveDayCloses } from "@/lib/history";

const TICKER_RE = /^[A-Z]{1,6}$/;
const MAX_WATCHLIST = 20;

/** Full watchlist with sparklines and latest-analysis links. Owner-only. */
export async function GET() {
  const denied = await requireOwner();
  if (denied) return denied;

  const rows = await db()
    .select()
    .from(watchlist)
    .orderBy(watchlist.addedAt);

  const tickers = rows.map((r) => r.ticker);
  const latestByTicker = new Map<string, number>();
  if (tickers.length) {
    // newest-first; first hit per ticker wins
    const recent = await db()
      .select({ id: analyses.id, ticker: analyses.ticker })
      .from(analyses)
      .where(inArray(analyses.ticker, tickers))
      .orderBy(desc(analyses.createdAt));
    for (const a of recent) {
      if (!latestByTicker.has(a.ticker)) latestByTicker.set(a.ticker, a.id);
    }
  }

  const items = await Promise.all(
    rows.map(async (r) => ({
      ticker: r.ticker,
      companyName: r.companyName,
      spark: await getFiveDayCloses(r.ticker),
      latestAnalysisId: latestByTicker.get(r.ticker) ?? null,
    }))
  );

  return NextResponse.json({ items });
}

export async function POST(request: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  let ticker: string;
  try {
    const body = await request.json();
    ticker = String(body.ticker ?? "")
      .trim()
      .toUpperCase();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON with a ticker field." },
      { status: 400 }
    );
  }
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json(
      { error: "Ticker must be 1-6 letters." },
      { status: 400 }
    );
  }

  const existing = await db().select().from(watchlist);
  if (existing.some((r) => r.ticker === ticker)) {
    return NextResponse.json(
      { error: `${ticker} is already on the watchlist.` },
      { status: 409 }
    );
  }
  if (existing.length >= MAX_WATCHLIST) {
    return NextResponse.json(
      { error: `Watchlist is capped at ${MAX_WATCHLIST} tickers (price polling quota).` },
      { status: 409 }
    );
  }

  try {
    const profile = await getProfile(ticker);
    if (isUnknownTicker(profile)) {
      return NextResponse.json(
        { error: `Finnhub doesn't recognise "${ticker}".` },
        { status: 404 }
      );
    }
    await db()
      .insert(watchlist)
      .values({ ticker, companyName: profile.name ?? null });
    return NextResponse.json({ ok: true, ticker, companyName: profile.name });
  } catch (err) {
    if (err instanceof FinnhubError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    throw err;
  }
}

export async function DELETE(request: NextRequest) {
  const denied = await requireOwner();
  if (denied) return denied;

  const ticker = request.nextUrl.searchParams.get("ticker")?.toUpperCase() ?? "";
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  }
  await db().delete(watchlist).where(eq(watchlist.ticker, ticker));
  return NextResponse.json({ ok: true });
}
