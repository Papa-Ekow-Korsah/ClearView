import { NextRequest, NextResponse } from "next/server";
import { validateTicker } from "@/lib/ticker";
import { checkRateLimit, ANALYZE_LIMIT } from "@/lib/rate-limit";
import { getCompanyProfile, saveCompanyProfile } from "@/lib/db/queries";
import { buildCompanyProfile } from "@/lib/company-profile";
import { fetchSources, getSourceRefs } from "@/lib/company-sources";
import { AnalysisGenerationError } from "@/lib/anthropic";
import type { TenKFailure } from "@/lib/tenk";
import { PROFILE_FORMAT_VERSION } from "@/types/company-profile";

/**
 * The company profile — what the business is, read out of its filings.
 *
 * Separate from /api/analyze on purpose. A profile is keyed to the set of
 * documents it was built from (10-K, latest 10-Q, recent earnings releases),
 * so it's generated when one of those changes — roughly quarterly — and
 * served from cache otherwise. Keeping it off the analysis path means it
 * neither slows an analysis down nor competes for that request's time budget.
 */
export const maxDuration = 300;

const FAILURE_MESSAGES: Record<TenKFailure, string> = {
  unreachable:
    "Couldn't reach the SEC to read this company's filings. That's a problem with the request, not a fact about the company — it very likely does file them. Try again shortly.",
  "no-filing":
    "The SEC lists no Form 10-K for this security. Foreign private issuers file 20-F or 40-F instead, which this reader doesn't cover, and funds don't file one at all.",
  unparsable:
    "This company's latest 10-K was retrieved but its Business and MD&A sections couldn't be located. Annual report formatting isn't standardised, and some filers — banks especially — incorporate those sections by reference.",
};

function failure(reason: TenKFailure) {
  // Three different statements. Saying "this company files no annual report"
  // because our own request failed would be a confident falsehood about the
  // company — the precise error this app exists to avoid.
  return NextResponse.json(
    { error: FAILURE_MESSAGES[reason], reason },
    { status: reason === "no-filing" ? 404 : 503 }
  );
}

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

  // Which documents are current? Read from SEC's filings index only — the
  // documents themselves are downloaded further down, and only for a rebuild.
  const found = await getSourceRefs(ticker).catch(
    () => ({ ok: false, reason: "unreachable" }) as const
  );

  const cached = await getCompanyProfile(ticker);
  const current =
    cached !== null &&
    found.ok &&
    cached.accession === found.refs.key &&
    cached.profile.formatVersion >= PROFILE_FORMAT_VERSION;
  // When SEC can't be reached, whatever is cached is still worth serving: it
  // was built from real filings and is at worst a quarter out of date.
  if (cached && (current || !found.ok)) {
    return NextResponse.json({ profile: cached.profile, cached: true });
  }
  if (!found.ok) return failure(found.reason);

  // Generating is the only expensive path, so only it is rate limited.
  const rate = await checkRateLimit("company-profile", ANALYZE_LIMIT.limit, ANALYZE_LIMIT.windowMs);
  if (!rate.allowed) {
    const mins = Math.ceil((rate.resetAt.getTime() - Date.now()) / 60000);
    return NextResponse.json(
      { error: `Profile limit reached. Resets in ~${mins} min.` },
      { status: 429 }
    );
  }

  const sources = await fetchSources(found.refs);
  if (!sources.ok) return failure(sources.reason);

  try {
    const profile = await buildCompanyProfile(
      ticker,
      request.nextUrl.searchParams.get("name") ?? ticker,
      found.refs,
      sources.docs
    );
    await saveCompanyProfile(ticker, found.refs.key, profile);
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
