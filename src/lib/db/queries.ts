import { desc, eq } from "drizzle-orm";
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

export async function listAnalyses(ticker?: string) {
  const base = db()
    .select({
      id: analyses.id,
      ticker: analyses.ticker,
      companyName: analyses.companyName,
      createdAt: analyses.createdAt,
    })
    .from(analyses)
    .orderBy(desc(analyses.createdAt));
  if (ticker) {
    return base.where(eq(analyses.ticker, ticker.toUpperCase()));
  }
  return base;
}

export async function deleteAnalysis(id: number) {
  await db().delete(analyses).where(eq(analyses.id, id));
}
