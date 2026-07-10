import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/guard";
import { getQuote, FinnhubError } from "@/lib/finnhub";

const TICKER_RE = /^[A-Z]{1,6}$/;

/** Live quote for watchlist polling. Owner-only — it spends Finnhub quota. */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  }

  try {
    const q = await getQuote(ticker);
    return NextResponse.json({
      ticker,
      price: q.c || null,
      change: q.d,
      changePct: q.dp,
      prevClose: q.pc || null,
    });
  } catch (err) {
    if (err instanceof FinnhubError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error fetching quote." },
      { status: 500 }
    );
  }
}
