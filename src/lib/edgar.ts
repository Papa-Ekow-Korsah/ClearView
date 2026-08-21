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

const SEC_UA = "ClearView personal research tool (contact via github.com/Papa-Ekow-Korsah/ClearView)";
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

/**
 * Most recent 8-K reporting results (Item 2.02) and its press release text.
 * Returns null whenever anything is missing — callers fall back to
 * unsourced generation and must label it as such.
 */
export async function getLatestEarningsRelease(
  ticker: string
): Promise<EarningsRelease | null> {
  try {
    const cik = await getCik(ticker);
    if (!cik) return null;

    const subRes = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
    if (!subRes.ok) return null;
    const subs = (await subRes.json()) as Submissions;
    const recent = subs.filings?.recent;
    if (!recent?.form) return null;

    // Item 2.02 = Results of Operations and Financial Condition
    let idx = -1;
    for (let i = 0; i < recent.form.length; i++) {
      if (recent.form[i] === "8-K" && (recent.items?.[i] ?? "").includes("2.02")) {
        idx = i;
        break; // recent[] is newest-first
      }
    }
    if (idx === -1) return null;

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
