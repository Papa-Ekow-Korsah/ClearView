import {
  pgTable,
  serial,
  text,
  timestamp,
  jsonb,
  integer,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { ResearchNote } from "@/types/analysis";
import type { ResearchNoteV2 } from "@/types/analysis-v2";

/** Every generated analysis, snapshotted in full so reopening never re-fetches. */
export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  note: jsonb("note").$type<ResearchNote | ResearchNoteV2>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const watchlist = pgTable(
  "watchlist",
  {
    id: serial("id").primaryKey(),
    ticker: text("ticker").notNull(),
    companyName: text("company_name"),
    addedAt: timestamp("added_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("watchlist_ticker_unique").on(t.ticker)]
);

/**
 * Fixed-window rate limiting. One row per (key, window start); serverless
 * instances share it, unlike in-memory counters.
 */
export const rateLimits = pgTable(
  "rate_limits",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [uniqueIndex("rate_limits_key_window_unique").on(t.key, t.windowStart)]
);
