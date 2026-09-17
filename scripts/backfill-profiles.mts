/**
 * Build company profiles from a machine that can reach EDGAR.
 *
 * SEC blocks Vercel's egress, so production cannot fetch filings itself. It
 * can still serve profiles: they're cached in Postgres keyed by the documents
 * they were built from, and the route returns a cached profile even when SEC
 * is unreachable. Running this from a normal network fills that cache.
 *
 *   npm run profiles -- MSFT NVDA KO
 *   npm run profiles -- --force MSFT      rebuild even if current
 *
 * Re-running is cheap: a ticker whose cached profile already matches its
 * current 10-K, 10-Q and earnings releases is skipped without calling the model.
 */
import { readFileSync } from "node:fs";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
}

const { getSourceRefs, fetchSources } = await import("@/lib/company-sources");
const { buildCompanyProfile } = await import("@/lib/company-profile");
const { getCompanyProfile, saveCompanyProfile, listAnalyses } = await import("@/lib/db/queries");
const { PROFILE_FORMAT_VERSION } = await import("@/types/company-profile");

const args = process.argv.slice(2);
const force = args.includes("--force");
// --verbose prints every dropped paragraph and why, to tune verification.
const verbose = args.includes("--verbose");
const tickers = args.filter((a) => !a.startsWith("--")).map((t) => t.toUpperCase());
if (tickers.length === 0) {
  console.error("usage: npm run profiles -- [--force] TICKER [TICKER...]");
  process.exit(1);
}

let built = 0;
let skipped = 0;
let failed = 0;

for (const ticker of tickers) {
  process.stdout.write(`${ticker.padEnd(6)} `);

  const found = await getSourceRefs(ticker);
  if (!found.ok) {
    console.log(`skip — ${found.reason}`);
    failed++;
    continue;
  }

  const cached = await getCompanyProfile(ticker);
  if (
    !force &&
    cached &&
    cached.accession === found.refs.key &&
    cached.profile.formatVersion >= PROFILE_FORMAT_VERSION
  ) {
    console.log("already current");
    skipped++;
    continue;
  }

  const sources = await fetchSources(found.refs);
  if (!sources.ok) {
    console.log(`skip — ${sources.reason}`);
    failed++;
    continue;
  }

  // The page reads "Derived from Apple Inc's Form 10-K", so use the name the
  // analyses already carry rather than the bare ticker.
  const [latest] = await listAnalyses(ticker);
  const name = latest?.companyName ?? ticker;

  const rejected: string[] = [];
  const dropped: string[] = [];
  try {
    const started = Date.now();
    const profile = await buildCompanyProfile(ticker, name, found.refs, sources.docs, {
      timeoutMs: 600_000,
      onSegmentReject: (segment, reason) => rejected.push(`${segment}: ${reason}`),
      onParagraphDiscard: (section, para, reason, detail) => {
        const quotes = para.evidence
          .map((e) => `      [${e.sourceId}] ${e.quote.slice(0, 160)}`)
          .join(String.fromCharCode(10));
        const label = `  [${section}] ${reason}${detail ? ` (${detail})` : ""}: ${para.text.slice(0, 180)}`;
        dropped.push([label, quotes].join(String.fromCharCode(10)));
      },
    });
    await saveCompanyProfile(ticker, found.refs.key, profile);

    const paragraphs = profile.sections.reduce(
      (n, s) => n + s.blocks.reduce((m, b) => m + b.paragraphs.length, 0),
      0
    );
    const words = profile.sections
      .flatMap((s) => s.blocks.flatMap((b) => b.paragraphs.map((p) => p.text)))
      .join(" ")
      .split(/\s+/).length;
    console.log(
      `built in ${((Date.now() - started) / 1000).toFixed(0)}s — ${paragraphs} paragraphs (~${words} words), ${profile.valueChain.length} flow steps, ${profile.segments.length} segments, ${profile.discarded} discarded, ${sources.docs.length} documents read`
    );
    for (const r of rejected) console.log(`         segment dropped — ${r}`);
    if (verbose) for (const d of dropped) console.log(d);
    built++;
  } catch (err) {
    console.log(`FAILED — ${err instanceof Error ? err.message : err}`);
    failed++;
  }
}

console.log(`\n${built} built, ${skipped} already current, ${failed} unavailable`);
process.exit(failed > 0 && built === 0 ? 1 : 0);
