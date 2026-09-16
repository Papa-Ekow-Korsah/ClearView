/**
 * Build company profiles from a machine that can reach EDGAR.
 *
 * SEC blocks Vercel's egress, so production cannot fetch a 10-K itself. It can
 * still serve one: profiles are cached in Postgres keyed by accession number,
 * and the route returns a cached profile even when SEC is unreachable. Running
 * this from a normal network fills that cache.
 *
 *   npm run profiles -- MSFT NVDA KO
 *
 * Re-running is cheap: a ticker whose cached profile already matches the
 * current filing is skipped without calling the model.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getLatestTenK } = await import("@/lib/tenk");
const { buildCompanyProfile } = await import("@/lib/company-profile");
const { getCompanyProfile, saveCompanyProfile } = await import("@/lib/db/queries");

const tickers = process.argv.slice(2).map((t) => t.toUpperCase());
if (tickers.length === 0) {
  console.error("usage: npm run profiles -- TICKER [TICKER...]");
  process.exit(1);
}

let built = 0;
let skipped = 0;
let failed = 0;

for (const ticker of tickers) {
  process.stdout.write(`${ticker.padEnd(6)} `);

  const result = await getLatestTenK(ticker);
  if (!result.ok) {
    console.log(`skip — ${result.reason}`);
    failed++;
    continue;
  }
  const tenK = result.tenK;

  const cached = await getCompanyProfile(ticker);
  if (cached && cached.accession === tenK.accession) {
    console.log(`already current (10-K ${tenK.filedDate})`);
    skipped++;
    continue;
  }

  try {
    const started = Date.now();
    const profile = await buildCompanyProfile(ticker, ticker, tenK);
    await saveCompanyProfile(ticker, tenK.accession, profile);
    const verified = profile.sections.reduce((n, s) => n + s.claims.length, 0);
    console.log(
      `built in ${((Date.now() - started) / 1000).toFixed(0)}s — ${verified} verified, ${profile.discardedClaims} discarded (10-K ${tenK.filedDate})`
    );
    built++;
  } catch (err) {
    console.log(`FAILED — ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log(`\n${built} built, ${skipped} already current, ${failed} unavailable`);
process.exit(failed > 0 && built === 0 ? 1 : 0);
