import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/guard";

// TEMPORARY diagnostic: EDGAR retrieval works locally but returns null on
// Vercel. Every step is try/caught in lib/edgar.ts, so this reports where
// it actually breaks. Owner-only; delete once diagnosed.
const UA =
  "ClearView personal research tool (contact via github.com/Papa-Ekow-Korsah/ClearView)";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { ticker } = await params;
  const steps: Record<string, unknown> = {};

  try {
    const t0 = Date.now();
    const tickRes = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    steps.tickerTable = {
      status: tickRes.status,
      ms: Date.now() - t0,
      contentType: tickRes.headers.get("content-type"),
    };
    if (!tickRes.ok) {
      steps.tickerTableBody = (await tickRes.text()).slice(0, 300);
      return NextResponse.json(steps);
    }

    const raw = (await tickRes.json()) as Record<
      string,
      { cik_str: number; ticker: string }
    >;
    const hit = Object.values(raw).find(
      (e) => e?.ticker?.toUpperCase() === ticker.toUpperCase()
    );
    steps.cik = hit ? String(hit.cik_str).padStart(10, "0") : null;
    if (!hit) return NextResponse.json(steps);

    const cik = String(hit.cik_str).padStart(10, "0");
    const subRes = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    steps.submissions = { status: subRes.status };
    if (!subRes.ok) {
      steps.submissionsBody = (await subRes.text()).slice(0, 300);
      return NextResponse.json(steps);
    }

    const subs = await subRes.json();
    const r = subs?.filings?.recent;
    const idx = (r?.form ?? []).findIndex(
      (f: string, i: number) => f === "8-K" && (r.items?.[i] ?? "").includes("2.02")
    );
    steps.found8K = idx > -1 ? { date: r.filingDate[idx], acc: r.accessionNumber[idx] } : null;
    if (idx === -1) return NextResponse.json(steps);

    const acc = r.accessionNumber[idx].replace(/-/g, "");
    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${acc}`;
    const idxRes = await fetch(`${base}/index.json`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    steps.filingIndex = { status: idxRes.status };
    if (!idxRes.ok) {
      steps.filingIndexBody = (await idxRes.text()).slice(0, 300);
      return NextResponse.json(steps);
    }

    const dir = await idxRes.json();
    steps.files = (dir?.directory?.item ?? []).map((f: { name: string }) => f.name);
    return NextResponse.json(steps);
  } catch (err) {
    steps.threw = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    return NextResponse.json(steps, { status: 500 });
  }
}
