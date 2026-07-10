import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { config } from "@/lib/config";
import * as schema from "@/lib/db/schema";

let _db: ReturnType<typeof createDb> | null = null;

function createDb() {
  const sql = neon(config.databaseUrl);
  return drizzle(sql, { schema });
}

/** Lazy singleton — only connects when a feature actually needs the DB. */
export function db() {
  if (!_db) _db = createDb();
  return _db;
}
