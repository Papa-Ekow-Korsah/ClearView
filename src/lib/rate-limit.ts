import { sql } from "drizzle-orm";
import { db } from "@/lib/db/client";
import { rateLimits } from "@/lib/db/schema";

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

/**
 * Fixed-window rate limiter backed by Postgres — Vercel serverless
 * instances don't share memory, so an in-memory counter would be a no-op
 * in production. One atomic upsert per check.
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowMs: number
): Promise<RateLimitResult> {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const resetAt = new Date(windowStart.getTime() + windowMs);

  const [row] = await db()
    .insert(rateLimits)
    .values({ key, windowStart, count: 1 })
    .onConflictDoUpdate({
      target: [rateLimits.key, rateLimits.windowStart],
      set: { count: sql`${rateLimits.count} + 1` },
    })
    .returning({ count: rateLimits.count });

  const count = row?.count ?? limit + 1;
  return {
    allowed: count <= limit,
    remaining: Math.max(0, limit - count),
    resetAt,
  };
}

/** Analysis generation: 10 per hour keeps API spend bounded. */
export const ANALYZE_LIMIT = { limit: 10, windowMs: 60 * 60 * 1000 };
