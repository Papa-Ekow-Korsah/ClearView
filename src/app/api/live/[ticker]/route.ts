import { NextRequest, NextResponse } from "next/server";
import { getQuote, getMetrics, FinnhubError } from "@/lib/finnhub";
import { buildRatioValues } from "@/lib/ratios";

const TICKER_RE = /^[A-Z]{1,6}$/;

/**
 * Live overlay for saved notes: current quote + fresh ratio values.
 * Public — notes are publicly readable and this endpoint spends no AI
 * credits. Server-side caches (30s quote, 15min metrics) mean even many
 * viewers produce at most ~2 Finnhub calls/min per ticker.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: raw } = await params;
  const ticker = raw.toUpperCase();
  if (!TICKER_RE.test(ticker)) {
    return NextResponse.json({ error: "Invalid ticker." }, { status: 400 });
  }

  try {
    const [quote, metricsRes] = await Promise.all([
      getQuote(ticker),
      getMetrics(ticker),
    ]);
    const ratioValues = buildRatioValues(metricsRes.metric, []);
    return NextResponse.json({
      ticker,
      price: quote.c || null,
      changePct: quote.dp ?? null,
      updatedAt: new Date().toISOString(),
      ratios: Object.fromEntries(ratioValues.map((r) => [r.key, r.value])),
    });
  } catch (err) {
    if (err instanceof FinnhubError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    return NextResponse.json(
      { error: "Unexpected error fetching live data." },
      { status: 500 }
    );
  }
}
