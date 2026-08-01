import { and, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { analyses } from "@/lib/db/schema";

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
