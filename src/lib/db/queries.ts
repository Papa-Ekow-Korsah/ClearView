import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import type { CompanyProfile } from "@/types/company-profile";
import { analyses, companyProfiles } from "@/lib/db/schema";

export async function getAnalysisById(id: number) {
  const [row] = await db()
    .select()
    .from(analyses)
    .where(eq(analyses.id, id))
    .limit(1);
  return row ?? null;
}

/** Visible history — soft-deleted notes are excluded. */
export async function listAnalyses(ticker?: string) {
  const base = db()
    .select({
      id: analyses.id,
      ticker: analyses.ticker,
      companyName: analyses.companyName,
      note: analyses.note,
      createdAt: analyses.createdAt,
    })
    .from(analyses)
    .orderBy(desc(analyses.createdAt));

  if (ticker) {
    return base.where(
      and(eq(analyses.ticker, ticker.toUpperCase()), isNull(analyses.deletedAt))
    );
  }
  return base.where(isNull(analyses.deletedAt));
}

/**
 * Every call ever made, including deleted ones. The track record must see
 * deleted calls or it becomes a highlight reel rather than a record.
 */
export async function listAllCalls() {
  return db()
    .select({
      id: analyses.id,
      ticker: analyses.ticker,
      companyName: analyses.companyName,
      note: analyses.note,
      createdAt: analyses.createdAt,
      deletedAt: analyses.deletedAt,
    })
    .from(analyses)
    .orderBy(desc(analyses.createdAt));
}

/** Soft delete — preserves the row for scoring. */
export async function deleteAnalysis(id: number) {
  await db()
    .update(analyses)
    .set({ deletedAt: new Date() })
    .where(eq(analyses.id, id));
}

/**
 * A cached company profile for this ticker, newest filing first. Returned
 * regardless of which 10-K it came from — the caller compares the accession
 * against the current filing to decide whether it is still the latest.
 */
export async function getCompanyProfile(ticker: string) {
  const [row] = await db()
    .select()
    .from(companyProfiles)
    .where(eq(companyProfiles.ticker, ticker.toUpperCase()))
    .orderBy(desc(companyProfiles.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * Store a profile. Conflicts are ignored rather than overwritten: two callers
 * racing on the same filing produce equivalent profiles, and the first one
 * home is as good as the second.
 */
export async function saveCompanyProfile(
  ticker: string,
  accession: string,
  profile: CompanyProfile
) {
  await db()
    .insert(companyProfiles)
    .values({ ticker: ticker.toUpperCase(), accession, profile })
    .onConflictDoNothing();
}
