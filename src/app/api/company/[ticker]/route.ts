import { NextRequest, NextResponse } from "next/server";
import { validateTicker } from "@/lib/ticker";
import { checkRateLimit, ANALYZE_LIMIT } from "@/lib/rate-limit";
import { getCompanyProfile, saveCompanyProfile } from "@/lib/db/queries";
import { buildCompanyProfile } from "@/lib/company-profile";
import { getLatestTenK } from "@/lib/tenk";
import { AnalysisGenerationError } from "@/lib/anthropic";

/**
 * The company profile — what the business is, read out of its 10-K.
 *
 * Separate from /api/analyze on purpose. A profile is keyed to an annual
 * filing, so it is generated once per company per year and served from cache
 * after that. Keeping it off the analysis path means it neither slows an
 * analysis down nor competes for that request's time budget.
 */
export const maxDuration = 300;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ ticker: string }> }
) {
  const { ticker: raw } = await params;
  const validation = validateTicker(raw);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }
  const ticker = validation.ticker;

  // Which 10-K is current? This is the cache key, and it's cheap — SEC
  // metadata, no model involved.
  const result = await getLatestTenK(ticker).catch(
    () => ({ ok: false, reason: "unreachable" }) as const
  );

  // A cached profile is still worth serving when SEC is unreachable: it was
  // built from a real filing and is only at risk of being a year out of date.
  const cached = await getCompanyProfile(ticker);
  if (cached && (!result.ok || cached.accession === result.tenK.accession)) {
    return NextResponse.json({ profile: cached.profile, cached: true });
  }

  if (!result.ok) {
    // Three different statements. Saying "this company files no annual report"
    // because our own request failed would be a confident falsehood about the
    // company — the precise error this app exists to avoid.
    const messages: Record<typeof result.reason, string> = {
      unreachable:
        "Couldn't reach the SEC to read this company's annual report. That's a problem with the request, not a fact about the company — it very likely does file one. Try again shortly.",
      "no-filing":
        "The SEC lists no Form 10-K for this security. Foreign private issuers file 20-F or 40-F instead, which this reader doesn't cover, and funds don't file one at all.",
      unparsable:
        "This company's latest 10-K was retrieved but its Business and MD&A sections couldn't be located. Annual report formatting isn't standardised, and some filers — banks especially — incorporate those sections by reference.",
    };
    return NextResponse.json(
      { error: messages[result.reason], reason: result.reason },
      { status: result.reason === "no-filing" ? 404 : 503 }
    );
  }
  const tenK = result.tenK;

  // Generating is the only expensive path, so only it is rate limited — a
  // cache hit above costs nothing and shouldn't consume anyone's quota.
  const rate = await checkRateLimit(
    "company-profile",
    ANALYZE_LIMIT.limit,
    ANALYZE_LIMIT.windowMs
  );
  if (!rate.allowed) {
    const mins = Math.ceil((rate.resetAt.getTime() - Date.now()) / 60000);
    return NextResponse.json(
      { error: `Profile limit reached. Resets in ~${mins} min.` },
      { status: 429 }
    );
  }

  try {
    const profile = await buildCompanyProfile(
      ticker,
      request.nextUrl.searchParams.get("name") ?? ticker,
      tenK
    );
    await saveCompanyProfile(ticker, tenK.accession, profile);
    return NextResponse.json({ profile, cached: false });
  } catch (err) {
    if (err instanceof AnalysisGenerationError) {
      return NextResponse.json({ error: err.message }, { status: 502 });
    }
    console.error("company profile failed:", err);
    return NextResponse.json(
      { error: "Unexpected error building the company profile." },
      { status: 500 }
    );
  }
}
