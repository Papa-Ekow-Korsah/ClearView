/**
 * Every filed document the company profile is allowed to draw on.
 *
 * The annual report alone says what a company is; it doesn't say what has
 * happened since it was written. So the profile reads four kinds of filing,
 * all from EDGAR and all legally reviewed disclosure:
 *  - 10-K Item 1 (Business), Item 1A (Risk Factors), Item 7 (MD&A);
 *  - the latest 10-Q's MD&A, if filed after the 10-K;
 *  - the two most recent earnings releases (8-K Item 2.02, exhibit 99).
 * Each becomes a SourceDoc with a stable id, so every quote in the profile
 * can be traced back to the specific document it was verified against.
 */

import { getCik, htmlToText, pickPressRelease, secFetch } from "@/lib/edgar";
import {
  extractQuarterlyMdna,
  extractRiskFactors,
  extractSections,
  type TenKFailure,
} from "@/lib/tenk";
import type { SourceDocMeta } from "@/types/company-profile";

export interface SourceDoc extends SourceDocMeta {
  text: string;
}

interface Submissions {
  filings?: {
    recent?: {
      form?: string[];
      items?: string[];
      accessionNumber?: string[];
      filingDate?: string[];
      reportDate?: string[];
      primaryDocument?: string[];
    };
  };
}

interface FilingRef {
  accession: string;
  filedDate: string;
  reportDate: string;
  folderUrl: string;
  primaryUrl: string;
}

export interface SourceRefs {
  cik: string;
  tenK: FilingRef;
  tenQ: FilingRef | null;
  releases: FilingRef[];
  /**
   * Identifies this exact set of documents. A profile built from it is
   * current until any one of them is superseded — a new 10-K, 10-Q or
   * earnings release — so the cache refreshes quarterly, not just annually.
   */
  key: string;
}

export type SourceRefsResult = { ok: true; refs: SourceRefs } | { ok: false; reason: TenKFailure };

/** Which documents to read, from SEC's filings index alone — no downloads. */
export async function getSourceRefs(ticker: string): Promise<SourceRefsResult> {
  let cik: string | null;
  try {
    cik = await getCik(ticker);
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  if (!cik) return { ok: false, reason: "unreachable" };

  try {
    const res = await secFetch(`https://data.sec.gov/submissions/CIK${cik}.json`);
    if (!res.ok) return { ok: false, reason: "unreachable" };
    const recent = ((await res.json()) as Submissions).filings?.recent;
    if (!recent?.form) return { ok: false, reason: "unreachable" };

    const refAt = (i: number): FilingRef | null => {
      const accession = recent.accessionNumber?.[i];
      const primary = recent.primaryDocument?.[i];
      if (!accession || !primary) return null;
      const folderUrl = `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accession.replace(/-/g, "")}`;
      return {
        accession,
        filedDate: recent.filingDate?.[i] ?? "",
        reportDate: recent.reportDate?.[i] ?? "",
        folderUrl,
        primaryUrl: `${folderUrl}/${primary}`,
      };
    };

    const tenKIdx = recent.form.indexOf("10-K");
    if (tenKIdx === -1) return { ok: false, reason: "no-filing" };
    const tenK = refAt(tenKIdx);
    if (!tenK) return { ok: false, reason: "unparsable" };

    // recent[] is newest-first, so any 10-Q found before the 10-K's index
    // was filed after it and adds something the annual report can't.
    const tenQIdx = recent.form.findIndex((f, i) => f === "10-Q" && i < tenKIdx);
    const tenQ = tenQIdx === -1 ? null : refAt(tenQIdx);

    const releases: FilingRef[] = [];
    for (let i = 0; i < recent.form.length && releases.length < 2; i++) {
      if (recent.form[i] === "8-K" && (recent.items?.[i] ?? "").includes("2.02")) {
        const ref = refAt(i);
        if (ref) releases.push(ref);
      }
    }

    const key = [tenK.accession, tenQ?.accession ?? "-", ...releases.map((r) => r.accession)].join("|");
    return { ok: true, refs: { cik, tenK, tenQ, releases, key } };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

interface DirectoryIndex {
  directory?: { item?: { name: string; size?: string }[] };
}

async function fetchText(url: string): Promise<string | null> {
  const res = await secFetch(url);
  return res.ok ? res.text() : null;
}

async function fetchReleaseDoc(ref: FilingRef, n: number): Promise<SourceDoc | null> {
  const idx = await secFetch(`${ref.folderUrl}/index.json`);
  if (!idx.ok) return null;
  const files = ((await idx.json()) as DirectoryIndex).directory?.item ?? [];
  const name = pickPressRelease(files, null);
  if (!name) return null;
  const html = await fetchText(`${ref.folderUrl}/${name}`);
  if (!html) return null;
  const text = htmlToText(html);
  if (text.length < 400) return null;
  return {
    id: `release${n}`,
    kind: "8-K",
    label: `Earnings release (8-K filed ${ref.filedDate})`,
    filedDate: ref.filedDate,
    url: `${ref.folderUrl}/${name}`,
    text: text.slice(0, 30_000),
  };
}

export type SourcesResult = { ok: true; docs: SourceDoc[] } | { ok: false; reason: TenKFailure };

/**
 * Download and extract every document. The 10-K is required — it's what says
 * what the business is. The 10-Q and releases add recency and are included
 * whenever they can be read; a failure on one of them narrows the profile
 * rather than blocking it.
 */
export async function fetchSources(refs: SourceRefs): Promise<SourcesResult> {
  const tenKHtml = await fetchText(refs.tenK.primaryUrl).catch(() => null);
  if (!tenKHtml) return { ok: false, reason: "unreachable" };

  const { business, mdna } = extractSections(tenKHtml);
  if (!business && !mdna) return { ok: false, reason: "unparsable" };
  const risks = extractRiskFactors(tenKHtml);

  const docs: SourceDoc[] = [];
  const tenKLabel = `Form 10-K filed ${refs.tenK.filedDate}`;
  if (business) {
    docs.push({ id: "10k-business", kind: "10-K", label: `${tenKLabel} — Item 1, Business`, filedDate: refs.tenK.filedDate, url: refs.tenK.primaryUrl, text: business });
  }
  if (risks) {
    docs.push({ id: "10k-risks", kind: "10-K", label: `${tenKLabel} — Item 1A, Risk Factors`, filedDate: refs.tenK.filedDate, url: refs.tenK.primaryUrl, text: risks });
  }
  if (mdna) {
    docs.push({ id: "10k-mdna", kind: "10-K", label: `${tenKLabel} — Item 7, MD&A`, filedDate: refs.tenK.filedDate, url: refs.tenK.primaryUrl, text: mdna });
  }

  // Sequential rather than parallel: SEC rate-limits, and this path runs from
  // a backfill or a cache miss where a few extra seconds cost nothing.
  if (refs.tenQ) {
    const html = await fetchText(refs.tenQ.primaryUrl).catch(() => null);
    const quarterly = html ? extractQuarterlyMdna(html) : null;
    if (quarterly) {
      docs.push({
        id: "10q-mdna",
        kind: "10-Q",
        label: `Form 10-Q filed ${refs.tenQ.filedDate} — MD&A`,
        filedDate: refs.tenQ.filedDate,
        url: refs.tenQ.primaryUrl,
        text: quarterly,
      });
    }
  }

  for (const [i, ref] of refs.releases.entries()) {
    const doc = await fetchReleaseDoc(ref, i + 1).catch(() => null);
    if (doc) docs.push(doc);
  }

  return { ok: true, docs };
}
