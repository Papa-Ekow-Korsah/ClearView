/**
 * Direct EDGAR access for documents that no structured feed carries.
 *
 * Guidance is the motivating case: it isn't in any affordable data feed, but
 * it IS stated verbatim in the earnings press release filed as an 8-K
 * exhibit under Item 2.02. Retrieving that document lets the model extract
 * guidance from a real source it can cite, rather than recalling a number —
 * which is the difference between grounded extraction and invention.
 *
 * EDGAR is public domain and free. SEC asks for a descriptive User-Agent
 * and rate-limits to ~10 req/s; each analysis makes at most four calls.
 */

/**
 * SEC asks for a descriptive User-Agent naming the requester, and its edge
 * rejects anything containing a URL or bare domain with a 403 — which is
 * what a "contact via github.com/..." string here used to trigger on every
 * single call, from any network. A plain name is accepted; a name plus an
 * email is what SEC's own guidance asks for, so SEC_CONTACT_EMAIL is used
 * when it's set. Never put a URL in this string.
 */
const SEC_CONTACT = process.env.SEC_CONTACT_EMAIL?.trim();
const SEC_UA = SEC_CONTACT
  ? `ClearView personal research tool ${SEC_CONTACT}`
  : "ClearView personal research tool";
const HOUR = 3_600_000;

async function secFetch(url: string): Promise<Response> {
  return fetch(url, {
    headers: { "User-Agent": SEC_UA, Accept: "application/json, text/html" },
    cache: "no-store",
  });
}

// ── ticker → CIK ─────────────────────────────────────────────────

let tickerMap: { expires: number; map: Map<string, string> } | null = null;

interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

/** SEC's ticker→CIK table (~1MB), cached hard since it changes rarely. */
export async function getCik(ticker: string): Promise<string | null> {
  if (!tickerMap || tickerMap.expires < Date.now()) {
    try {
      const res = await secFetch("https://www.sec.gov/files/company_tickers.json");
      if (!res.ok) return null;
      const raw = (await res.json()) as Record<string, TickerEntry>;
      const map = new Map<string, string>();
      for (const entry of Object.values(raw)) {
        if (entry?.ticker) {
          map.set(entry.ticker.toUpperCase(), String(entry.cik_str).padStart(10, "0"));
        }
      }
      tickerMap = { expires: Date.now() + 24 * HOUR, map };
    } catch {
      return null;
    }
  }
  return tickerMap.map.get(ticker.toUpperCase()) ?? null;
}

// ── earnings press release ───────────────────────────────────────

export interface EarningsRelease {
  /** Plain text of the press release, truncated for prompt use */
  text: string;
  /** Public EDGAR URL, shown to the user so any figure can be checked */
  url: string;
  filedDate: string;
  form: string;
}

interface Submissions {
  filings?: {
    recent?: {
      form?: string[];
      items?: string[];
      accessionNumber?: string[];
      filingDate?: string[];
    };
  };
}

interface DirectoryIndex {
  directory?: { item?: { name: string; size?: string }[] };
}

/** Strip HTML to readable text. Press releases are simple documents. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The exhibit holding the press release. EDGAR filenames aren't
 * standardised, so prefer an obvious "ex99"/"press"/"release" name and fall
 * back to the largest .htm that isn't the cover page or a rendered R-file.
 */
export function pickPressRelease(
  items: { name: string; size?: string }[],
  primaryDoc: string | null
): string | null {
  const htm = items.filter(
    (f) =>
      /\.htm$/i.test(f.name) &&
      !/^R\d+\.htm$/i.test(f.name) &&
      !/-index/i.test(f.name) &&
      f.name !== primaryDoc
  );
  if (htm.length === 0) return null;

  const named = htm.find((f) => /ex.?99|press|release|earnings/i.test(f.name));
  if (named) return named.name;

  return htm.sort((a, b) => Number(b.size ?? 0) - Number(a.size ?? 0))[0].name;
}

const MAX_CHARS = 18_000;

/** Where a release states what management expects, rather than what it did. */
const OUTLOOK_RE = /\b(outlook|guidance|expects?\s+(?:to|revenue|full|first|second|third|fourth)|for\s+the\s+(?:first|second|third|fourth)\s+quarter\s+of\s+fiscal)\b/i;

/**
 * The part of a release that carries guidance, for when the whole document
 * would be wasteful to pass on. Centred slightly before the first outlook
 * mention so the sentence introducing it survives; falls back to the head of
 * the document, which is where a short release states everything anyway.
 */
export function guidanceExcerpt(text: string, chars = 6_000): string {
  if (text.length <= chars) return text;
  const at = text.search(OUTLOOK_RE);
  if (at === -1) return text.slice(0, chars);
  const start = Math.max(0, at - 500);
  return text.slice(start, start + chars);
}

/**
 * The most recent 8-Ks reporting results (Item 2.02), newest first.
 *
 * Two is the useful number: the newest states what the company just
 * delivered, and the one before it states what the company had promised for
 * that same quarter. Holding both is what makes "did management hit its own
 * guidance?" a checkable question rather than a recalled one.
 *
 * Returns fewer than requested, or none, whenever anything is missing —
 * callers fall back to unsourced generation and must label it as such.
 */
export async function getRecentEarningsReleases(
  ticker: string,
  count = 2
): Promise<EarningsRelease[]> {
  try {
    const cik = await getCik(ticker);
    if (!cik) return [];

    const subRes = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
    if (!subRes.ok) return [];
    const subs = (await subRes.json()) as Submissions;
    const recent = subs.filings?.recent;
    if (!recent?.form) return [];

    // Item 2.02 = Results of Operations and Financial Condition. recent[] is
    // newest-first, so collecting in order gives newest-first releases.
    const candidates: number[] = [];
    for (let i = 0; i < recent.form.length && candidates.length < count * 2; i++) {
      if (recent.form[i] === "8-K" && (recent.items?.[i] ?? "").includes("2.02")) {
        candidates.push(i);
      }
    }
    if (candidates.length === 0) return [];

    const out: EarningsRelease[] = [];
    // Sequential, not parallel: SEC rate-limits, and an extra second on a
    // path that already takes minutes is not worth risking a 429 over.
    for (const idx of candidates) {
      if (out.length >= count) break;
      const release = await fetchRelease(cik, recent, idx);
      if (release) out.push(release);
    }
    return out;
  } catch {
    return [];
  }
}

async function fetchRelease(
  cik: string,
  recent: NonNullable<NonNullable<Submissions["filings"]>["recent"]>,
  idx: number
): Promise<EarningsRelease | null> {
  try {
    const accession = (recent.accessionNumber?.[idx] ?? "").replace(/-/g, "");
    const filedDate = recent.filingDate?.[idx] ?? "";
    if (!accession) return null;

    const base = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}`;
    const idxRes = await secFetch(`${base}/index.json`);
    if (!idxRes.ok) return null;
    const dir = (await idxRes.json()) as DirectoryIndex;
    const files = dir.directory?.item ?? [];

    const docName = pickPressRelease(files, null);
    if (!docName) return null;

    const docRes = await secFetch(`${base}/${docName}`);
    if (!docRes.ok) return null;
    const text = htmlToText(await docRes.text());
    if (text.length < 400) return null; // too short to be a real release

    return {
      text: text.slice(0, MAX_CHARS),
      url: `${base}/${docName}`,
      filedDate,
      form: "8-K",
    };
  } catch {
    return null;
  }
}

/** The latest results 8-K alone. */
export async function getLatestEarningsRelease(
  ticker: string
): Promise<EarningsRelease | null> {
  return (await getRecentEarningsReleases(ticker, 1))[0] ?? null;
}
