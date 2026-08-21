import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/guard";

// TEMPORARY diagnostic. SEC 403s ("Request Rate Threshold Exceeded") from
// Vercel while the identical request succeeds from a residential IP. Probe
// each host and User-Agent variant independently to tell an IP-level block
// apart from a User-Agent policy rejection. Owner-only; delete once fixed.

const UA_URL =
  "ClearView personal research tool (contact via github.com/Papa-Ekow-Korsah/ClearView)";
const UA_PLAIN = "ClearView/2.0";

async function probe(url: string, ua: string) {
  const t0 = Date.now();
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": ua },
      cache: "no-store",
    });
    const body = res.ok ? "" : (await res.text()).slice(0, 160).replace(/\s+/g, " ");
    return { status: res.status, ms: Date.now() - t0, body };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err), ms: Date.now() - t0 };
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const denied = await requireOwner();
  if (denied) return denied;
  await params;

  // NVDA CIK is fixed, so these URLs need no prior lookup.
  return NextResponse.json({
    "www.sec.gov tickers (UA with url)": await probe(
      "https://www.sec.gov/files/company_tickers.json",
      UA_URL
    ),
    "www.sec.gov tickers (plain UA)": await probe(
      "https://www.sec.gov/files/company_tickers.json",
      UA_PLAIN
    ),
    "data.sec.gov submissions (UA with url)": await probe(
      "https://data.sec.gov/submissions/CIK0001045810.json",
      UA_URL
    ),
    "www.sec.gov Archives index (UA with url)": await probe(
      "https://www.sec.gov/Archives/edgar/data/1045810/000104581026000051/index.json",
      UA_URL
    ),
  });
}
