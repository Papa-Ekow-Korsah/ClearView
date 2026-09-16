/**
 * The 10-K, read for what the business actually is.
 *
 * Item 1 (Business) and Item 7 (MD&A) are the only places a company describes
 * its own operations, customers, competition and plans under legal review.
 * Everything the company profile asserts is quoted out of these two sections,
 * so this module's job is to hand back their text accurately or nothing at all
 * — a mis-sliced section would put the model's own words where a filing's are
 * supposed to be.
 *
 * EDGAR HTML is not standardised, so extraction is heuristic. Every heuristic
 * here was derived from real filings (AAPL, HPQ, NVDA, KO, MSFT, JPM, TSLA);
 * where one fails the section comes back null and the caller degrades.
 */

import { getCik, secFetch } from "@/lib/edgar";

export interface TenK {
  url: string;
  accession: string;
  filedDate: string;
  /** Item 1 — Business. The operating description. */
  business: string | null;
  /** Item 7 — Management's Discussion and Analysis. Strategy and plans. */
  mdna: string | null;
}

interface Submissions {
  filings?: {
    recent?: {
      form?: string[];
      accessionNumber?: string[];
      filingDate?: string[];
      primaryDocument?: string[];
    };
  };
}

/** Block-level close tags become line breaks, so headings keep their own line. */
const BLOCK_CLOSE = /<\/(p|div|tr|h[1-6]|li|table|section)>/gi;

/**
 * Filing HTML to lines, preserving block structure.
 *
 * The line breaks are the whole point: flattened to one string, a genuine
 * "Item 1. Business" heading is indistinguishable from the sentence "...refer
 * to Part I, Item 1. Business of this report", and Coca-Cola's 10-K contains
 * exactly that.
 */
export function toLines(html: string): string[] {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(BLOCK_CLOSE, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&[a-z]+;/gi, " ")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

// Real headings run to 94 characters ("Item 7. Management's Discussion and
// Analysis of Financial Condition and Results of Operations"), and several
// filers end them with a period. Apostrophes are curly in most filings.
const MAX_HEADING = 160;

function headingRe(num: string, title: string): RegExp {
  return new RegExp(`^(?:part\\s+[ivx]+[\\s.:-]+)?item\\s*${num}[.:\\s–—-]+${title}\\s*[.:]?\\s*$`, "i");
}

/** Lines that are a heading for this item, titled. */
function titledHeadings(lines: string[], num: string, title: string): number[] {
  const re = headingRe(num, title);
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].length <= MAX_HEADING && re.test(lines[i])) out.push(i);
  }
  return out;
}

/**
 * Lines that are a bare "Item 1." with no title — Microsoft's 10-K splits the
 * number and title into separate table cells, so the titled form never appears.
 * A bare number is also exactly what a table-of-contents row looks like, so it
 * only counts when real prose follows rather than more contents rows.
 */
function bareHeadings(lines: string[], num: string): number[] {
  const re = new RegExp(`^(?:part\\s+[ivx]+[\\s.:-]+)?item\\s*${num}\\s*[.:]?\\s*$`, "i");
  const out: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!re.test(lines[i])) continue;
    // Contents rows cluster: within the next few lines sits another item row.
    const ahead = lines.slice(i + 1, i + 6);
    const looksLikeContents = ahead.some((l) => /^(?:part\s+[ivx]+[\s.:-]+)?item\s*\d/i.test(l));
    const hasProse = ahead.some((l) => l.length > 200);
    if (!looksLikeContents && hasProse) out.push(i);
  }
  return out;
}

function startsFor(lines: string[], num: string, title: string): number[] {
  const titled = titledHeadings(lines, num, title);
  return titled.length > 0 ? titled : bareHeadings(lines, num);
}

/**
 * Text between one item heading and the next.
 *
 * Taken from the FIRST qualifying heading forwards. Contents rows are already
 * excluded by the patterns above, so the earliest real heading is where the
 * section begins — and working backwards actively breaks filings that repeat
 * the item number partway through. Microsoft's 10-K labels its closing
 * "Available Information" block "Item 1" again, and searching from the end
 * returned that tail instead of the business description.
 */
export function sliceItem(
  lines: string[],
  startNum: string,
  startTitle: string,
  endNum: string,
  endTitle: string,
  minLines = 10
): string | null {
  const starts = startsFor(lines, startNum, startTitle);
  const ends = startsFor(lines, endNum, endTitle);
  for (const start of starts) {
    const end = ends.find((e) => e > start + minLines);
    if (end !== undefined) return lines.slice(start, end).join("\n");
  }
  return null;
}

/** Keeps a section inside a sane prompt budget without cutting mid-sentence. */
function cap(text: string | null, chars: number): string | null {
  if (text === null) return null;
  if (text.length <= chars) return text;
  const cut = text.slice(0, chars);
  const lastBreak = cut.lastIndexOf("\n");
  return lastBreak > chars * 0.6 ? cut.slice(0, lastBreak) : cut;
}

const BUSINESS_CHARS = 90_000;
const MDNA_CHARS = 90_000;

export function extractSections(html: string): Pick<TenK, "business" | "mdna"> {
  const lines = toLines(html);
  return {
    business: cap(sliceItem(lines, "1", "business", "1A", "risk\\s*factors"), BUSINESS_CHARS),
    mdna: cap(
      sliceItem(
        lines,
        "7",
        "management.{0,3}s\\s*discussion(?:\\s*and\\s*analysis)?(?:\\s*of\\s*financial\\s*condition)?(?:\\s*and\\s*results\\s*of\\s*operations)?",
        "8",
        "financial\\s*statements(?:\\s*and\\s*supplementary\\s*data)?"
      ),
      MDNA_CHARS
    ),
  };
}

/**
 * Why a 10-K couldn't be read. These are three different statements and must
 * never be collapsed:
 *  - "unreachable": we couldn't reach SEC. Says nothing about the company.
 *  - "no-filing": SEC answered and this filer has no 10-K (foreign private
 *    issuers file 20-F; funds file none). A real fact about the company.
 *  - "unparsable": the 10-K exists but its sections couldn't be located.
 * Telling a reader Microsoft files no annual report because our request
 * failed would be exactly the kind of confident falsehood this app exists to
 * avoid.
 */
export type TenKFailure = "unreachable" | "no-filing" | "unparsable";

export type TenKResult =
  | { ok: true; tenK: TenK }
  | { ok: false; reason: TenKFailure };

/** The company's most recent annual report, or why there isn't one to read. */
export async function getLatestTenK(ticker: string): Promise<TenKResult> {
  let cik: string | null;
  try {
    cik = await getCik(ticker);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  // getCik returns null both when SEC is unreachable and when the ticker is
  // genuinely absent from the map. The map covers every US filer, so for a
  // ticker that quotes on a US exchange, unreachable is the likelier of the
  // two and the safer thing to claim.
  if (!cik) return { ok: false, reason: "unreachable" };

  try {
    const subRes = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
    if (!subRes.ok) return { ok: false, reason: "unreachable" };
    const subs = (await subRes.json()) as Submissions;
    const recent = subs.filings?.recent;
    if (!recent?.form) return { ok: false, reason: "unreachable" };

    // SEC answered and listed this filer's forms. A missing 10-K here is a
    // genuine fact about the company.
    const idx = recent.form.indexOf("10-K");
    if (idx === -1) return { ok: false, reason: "no-filing" };

    const accessionRaw = recent.accessionNumber?.[idx] ?? "";
    const primary = recent.primaryDocument?.[idx] ?? "";
    if (!accessionRaw || !primary) return { ok: false, reason: "unparsable" };

    const accession = accessionRaw.replace(/-/g, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession}/${primary}`;
    const docRes = await secFetch(url);
    if (!docRes.ok) return { ok: false, reason: "unreachable" };

    const { business, mdna } = extractSections(await docRes.text());
    if (!business && !mdna) return { ok: false, reason: "unparsable" };

    return {
      ok: true,
      tenK: {
        url,
        accession: accessionRaw,
        filedDate: recent.filingDate?.[idx] ?? "",
        business,
        mdna,
      },
    };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}
