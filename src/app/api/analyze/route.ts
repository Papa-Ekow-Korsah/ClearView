import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/guard";
import { checkRateLimit, ANALYZE_LIMIT } from "@/lib/rate-limit";
import {
  getQuote,
  getProfile,
  getMetrics,
  getPeerSymbols,
  getRecentNews,
  isUnknownTicker,
  FinnhubError,
} from "@/lib/finnhub";
import { selectPeers, buildPeerRow, orderRows } from "@/lib/peers";
import { generateAiNote, AnalysisGenerationError } from "@/lib/anthropic";
import { db } from "@/lib/db/client";
import { analyses } from "@/lib/db/schema";
import type { PeerRow, ResearchNote, Snapshot } from "@/types/analysis";

export const maxDuration = 120; // AI generation can take a while

const TICKER_RE = /^[A-Z]{1,6}$/;

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
      { error: "Ticker must be 1-6 letters, e.g. AAPL." },
      { status: 400 }
    );
  }

  const rate = await checkRateLimit(
    "analyze",
    ANALYZE_LIMIT.limit,
    ANALYZE_LIMIT.windowMs
  );
  if (!rate.allowed) {
    const mins = Math.ceil((rate.resetAt.getTime() - Date.now()) / 60000);
    return NextResponse.json(
      {
        error: `Analysis limit reached (${ANALYZE_LIMIT.limit}/hour to protect API quota). Resets in ~${mins} min.`,
      },
      { status: 429 }
    );
  }

  try {
    // 1. Subject company data (parallel)
    const [profile, quote, metricsRes, peerSymbols, news] = await Promise.all([
      getProfile(ticker),
      getQuote(ticker),
      getMetrics(ticker),
      getPeerSymbols(ticker),
      getRecentNews(ticker),
    ]);

    if (isUnknownTicker(profile)) {
      return NextResponse.json(
        { error: `Finnhub doesn't recognise "${ticker}". Check the symbol — US listings work best on the free tier.` },
        { status: 404 }
      );
    }

    const snapshot: Snapshot = {
      price: quote.c || null,
      dayChangePct: quote.dp ?? null,
      marketCap: profile.marketCapitalization ?? null,
      week52High: numMetric(metricsRes.metric, "52WeekHigh"),
      week52Low: numMetric(metricsRes.metric, "52WeekLow"),
      exchange: profile.exchange ?? null,
      industry: profile.finnhubIndustry ?? null,
      currency: profile.currency ?? null,
    };

    // 2. Peer data (parallel per peer; tolerate individual failures)
    const peerTickers = selectPeers(ticker, peerSymbols);
    const peerRows = await Promise.all(
      peerTickers.map(async (pt): Promise<PeerRow | null> => {
        try {
          const [pProfile, pMetrics] = await Promise.all([
            getProfile(pt),
            getMetrics(pt),
          ]);
          if (isUnknownTicker(pProfile)) return null;
          return buildPeerRow(
            pt,
            pProfile.name ?? pt,
            pMetrics.metric,
            pProfile.marketCapitalization ?? null
          );
        } catch {
          return null; // a missing peer shouldn't sink the analysis
        }
      })
    );

    const subjectRow = buildPeerRow(
      ticker,
      profile.name ?? ticker,
      metricsRes.metric,
      profile.marketCapitalization ?? null,
      true
    );
    const peers = orderRows([
      subjectRow,
      ...peerRows.filter((r): r is PeerRow => r !== null),
    ]);

    // 3. AI narrative (thesis, catalysts, risks, peer commentary)
    const ai = await generateAiNote({
      ticker,
      companyName: profile.name ?? ticker,
      industry: profile.finnhubIndustry ?? null,
      snapshot,
      subjectMetrics: metricsRes.metric,
      peers,
      news,
    });

    const note: ResearchNote = {
      ticker,
      companyName: profile.name ?? ticker,
      generatedAt: new Date().toISOString(),
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5",
      snapshot,
      ai,
      peers,
      newsHeadlines: news.slice(0, 8).map((n) => ({
        headline: n.headline,
        date: new Date(n.datetime * 1000).toISOString().slice(0, 10),
        source: n.source,
      })),
    };

    // 4. Persist to history
    const [saved] = await db()
      .insert(analyses)
      .values({ ticker, companyName: note.companyName, note })
      .returning({ id: analyses.id });

    return NextResponse.json({ id: saved.id, note });
  } catch (err) {
    if (err instanceof FinnhubError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    if (err instanceof AnalysisGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("analyze failed:", err);
    return NextResponse.json(
      {
        error: `Unexpected error during analysis: ${err instanceof Error ? err.message : "unknown"}`,
      },
      { status: 500 }
    );
  }
}

function numMetric(
  m: Record<string, number | string | null>,
  key: string
): number | null {
  const v = m?.[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
