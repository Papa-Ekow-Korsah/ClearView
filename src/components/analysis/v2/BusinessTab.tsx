"use client";

import { useEffect, useState } from "react";
import type { CompanyProfile, VerifiedClaim } from "@/types/company-profile";

/**
 * The company profile tab.
 *
 * Loaded on demand rather than with the analysis: a profile is keyed to an
 * annual filing, so it's cached server-side and usually returns instantly.
 * Every claim here survived a verbatim check against the 10-K, so the quote
 * beneath each point is the actual sentence it came from — the reader can
 * open the filing and find it.
 */
export function BusinessTab({
  ticker,
  companyName,
}: {
  ticker: string;
  companyName: string;
}) {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(`/api/company/${ticker}?name=${encodeURIComponent(companyName)}`)
      .then(async (res) => {
        const data = await res.json();
        if (cancelled) return;
        if (!res.ok) {
          setError(data.error ?? "Couldn't load the company profile.");
          setReason(data.reason ?? null);
        } else {
          setProfile(data.profile);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't reach the server.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ticker, companyName]);

  if (loading) return <LoadingState />;

  if (error) {
    return (
      <div className="bg-surface border border-line rounded-card px-4 py-4">
        <p className="text-[13px] font-medium mb-1">
          {reason === "no-filing"
            ? `No Form 10-K on file for ${ticker}`
            : reason === "unreachable"
              ? "Couldn't reach the SEC"
              : reason === "unparsable"
                ? `Couldn't read ${ticker}'s annual report`
                : "Couldn't build the company profile"}
        </p>
        <p className="text-xs text-ink-2 leading-relaxed">{error}</p>
      </div>
    );
  }

  if (!profile) return null;

  const total = profile.sections.reduce((n, s) => n + s.claims.length, 0);

  return (
    <div>
      {profile.opening && (
        <>
          <SectionLabel>In the company&apos;s own words</SectionLabel>
          <blockquote className="bg-surface border border-line border-l-[3px] border-l-accent rounded-card px-5 py-4 mb-6">
            <p className="text-[15px] text-ink leading-[1.75]">{profile.opening}</p>
            <p className="text-[11px] text-ink-3 mt-2.5">
              Opening of Item 1, {profile.filing.url ? "" : ""}
              <a
                href={profile.filing.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Form 10-K filed {profile.filing.filedDate} ↗
              </a>
            </p>
          </blockquote>
        </>
      )}

      {profile.sections.map((section) =>
        section.claims.length === 0 ? null : (
          <div key={section.key} className="mb-6">
            <SectionLabel>{section.title}</SectionLabel>
            <div className="grid gap-2.5">
              {section.claims.map((claim, i) => (
                <ClaimCard key={i} claim={claim} />
              ))}
            </div>
          </div>
        )
      )}

      <div className="bg-surface-2 border border-line rounded-card px-4 py-3">
        <p className="text-[11px] text-ink-3 leading-relaxed">
          <span className="font-medium text-ink-2">How this section is built.</span>{" "}
          Every statement above is drawn from {profile.companyName}&apos;s own Form
          10-K and carries the sentence it came from. Each quote was checked
          against the filing text before publishing, and any claim whose quote
          could not be found was discarded
          {profile.discardedClaims > 0
            ? ` — ${profile.discardedClaims} ${profile.discardedClaims === 1 ? "was" : "were"} dropped here`
            : ""}
          . {total} verified statement{total === 1 ? "" : "s"}. Nothing on this
          tab comes from the model&apos;s own knowledge of the company.
        </p>
      </div>
    </div>
  );
}

function ClaimCard({ claim }: { claim: VerifiedClaim }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="bg-surface border border-line rounded-card px-4 py-3.5">
      <p className="text-[13px] text-ink leading-[1.7]">{claim.point}</p>
      <button
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] text-ink-3 hover:text-accent mt-2 transition-colors"
      >
        {open ? "Hide source" : "Show the sentence this came from"}
      </button>
      {open && (
        <div className="mt-2 pt-2.5 border-t border-line">
          <p className="text-xs text-ink-2 leading-relaxed italic">
            &ldquo;{claim.quote}&rdquo;
          </p>
          <a
            href={claim.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-[10px] text-accent hover:underline mt-1.5"
          >
            {claim.sourceLabel} · Item {claim.source === "mdna" ? "7 (MD&A)" : "1 (Business)"} ↗
          </a>
        </div>
      )}
    </div>
  );
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 mb-3 pb-2 border-b border-line">
      {children}
    </h2>
  );
}

function LoadingState() {
  return (
    <div>
      <p className="text-[13px] text-ink-2 mb-4">
        Reading the latest annual report…{" "}
        <span className="text-ink-3">
          first time for this company takes about a minute; after that it&apos;s
          instant until they file again.
        </span>
      </p>
      <div className="grid gap-2.5">
        {[0, 1, 2, 3].map((i) => (
          <div
            key={i}
            className="bg-surface border border-line rounded-card px-4 py-3.5 animate-pulse"
          >
            <div className="h-3 bg-surface-2 rounded w-[85%] mb-2" />
            <div className="h-3 bg-surface-2 rounded w-[60%]" />
          </div>
        ))}
      </div>
    </div>
  );
}
