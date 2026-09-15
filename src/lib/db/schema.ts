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
import type { ResearchNoteEtf } from "@/types/analysis-etf";
import type { CompanyProfile } from "@/types/company-profile";

/** Every generated analysis, snapshotted in full so reopening never re-fetches. */
export const analyses = pgTable("analyses", {
  id: serial("id").primaryKey(),
  ticker: text("ticker").notNull(),
  companyName: text("company_name").notNull(),
  note: jsonb("note")
    .$type<ResearchNote | ResearchNoteV2 | ResearchNoteEtf>()
    .notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /**
   * Soft delete. Deleting a call must not erase it from the track record —
   * otherwise the record silently becomes survivorship-biased. Hidden from
   * the history list, still scored.
   */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

/**
 * The company profile, cached per filing rather than per analysis.
 *
 * A profile describes what the business is, which only changes when the
 * company files a new 10-K — annually. Keying on the accession number means
 * it is built once a year per company instead of on every analysis run: it
 * never competes for the analysis request budget, and the cost is a rounding
 * error. A new filing appears under a new accession and regenerates naturally.
 */
export const companyProfiles = pgTable(
  "company_profiles",
  {
    id: serial("id").primaryKey(),
    ticker: text("ticker").notNull(),
    /** SEC accession number of the 10-K this was built from. */
    accession: text("accession").notNull(),
    profile: jsonb("profile").$type<CompanyProfile>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [uniqueIndex("company_profiles_ticker_accession_unique").on(t.ticker, t.accession)]
);

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
