"use client";

import { useEffect, useState } from "react";
import type {
  CompanyProfile,
  CompanyProfileSection,
  SectionKey,
  VerifiedSegment,
  VerifiedValueStep,
} from "@/types/company-profile";

/**
 * The company profile tab.
 *
 * Loaded on demand rather than with the analysis: a profile is keyed to an
 * annual filing, so it's cached server-side and usually returns instantly.
 * Every statement and every charted figure passed a verbatim check against the
 * 10-K before it was stored, so each tile simply names the filing it was
 * derived from rather than asking the reader to expand quotes one by one.
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
      <div className="bg-surface border border-line rounded-card px-5 py-4">
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

  const byKey = new Map(profile.sections.map((s) => [s.key, s]));
  const segments = profile.segments ?? [];
  const valueChain = profile.valueChain ?? [];
  const hasChart = segments.length >= 2;
  const hasFlow = valueChain.length >= 2;
  // The analysis carries the proper name; an older profile may hold the ticker.
  const firm = companyName || profile.companyName;

  const derived = (items: { source: "business" | "mdna" }[]) => (
    <DerivedFrom profile={profile} firm={firm} sources={items.map((i) => i.source)} />
  );

  return (
    <div className="grid gap-4">
      {profile.opening && (
        <figure className="bg-surface border border-line rounded-card px-6 py-5">
          <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 mb-3">
            In {firm}&apos;s own words
          </p>
          <blockquote className="text-[16px] sm:text-[17px] text-ink leading-[1.7] border-l-[3px] border-accent pl-4">
            {profile.opening}
          </blockquote>
          <figcaption className="text-[11px] text-ink-3 mt-3">
            Opening of Item 1 (Business),{" "}
            <a
              href={profile.filing.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-accent hover:underline"
            >
              Form 10-K filed {profile.filing.filedDate} ↗
            </a>
          </figcaption>
        </figure>
      )}

      {(hasChart || hasFlow) && (
        <div className={`grid gap-4 ${hasChart && hasFlow ? "md:grid-cols-2" : ""}`}>
          {hasFlow && (
            <Tile title="How the business works" icon="flow" footer={derived(valueChain)}>
              <ValueChainFlow steps={valueChain} />
            </Tile>
          )}
          {hasChart && (
            <Tile
              title="Where the revenue comes from"
              subtitle={`Revenue by reportable segment, ${segments[0].period}`}
              icon="chart"
              footer={derived(segments)}
            >
              <SegmentBars segments={segments} />
            </Tile>
          )}
        </div>
      )}

      <SectionTile section={byKey.get("whatItIs")} icon="building" derived={derived} />

      <div className="grid gap-4 md:grid-cols-2">
        {(["howItMakesMoney", "customers", "competition", "plans"] as SectionKey[]).map((key) => (
          <SectionTile key={key} section={byKey.get(key)} icon={ICON_FOR[key]} derived={derived} />
        ))}
      </div>

      <p className="text-[11px] text-ink-3 leading-relaxed px-1">
        Every statement and figure on this tab was checked word-for-word against {firm}&apos;s
        own 10-K before publishing; anything that couldn&apos;t be found in the filing was
        dropped. Nothing here comes from the model&apos;s own knowledge of the company.
      </p>
    </div>
  );
}

// ── tiles ────────────────────────────────────────────────────────

type IconName = "building" | "money" | "people" | "shield" | "compass" | "chart" | "flow";

const ICON_FOR: Record<SectionKey, IconName> = {
  whatItIs: "building",
  howItMakesMoney: "money",
  customers: "people",
  competition: "shield",
  plans: "compass",
};

function Tile({
  title,
  subtitle,
  icon,
  footer,
  children,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  footer: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-surface border border-line rounded-card flex flex-col">
      <header className="flex items-start gap-3 px-5 pt-4 pb-3">
        <span className="w-8 h-8 rounded-el bg-accent-dim text-accent flex items-center justify-center shrink-0">
          <Icon name={icon} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[14px] font-semibold leading-tight">{title}</h2>
          {subtitle && <p className="text-[11px] text-ink-3 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      <div className="px-5 pb-4 flex-1">{children}</div>
      <footer className="px-5 py-2.5 border-t border-line bg-surface-2/60 rounded-b-card">
        {footer}
      </footer>
    </section>
  );
}

function SectionTile({
  section,
  icon,
  derived,
}: {
  section: CompanyProfileSection | undefined;
  icon: IconName;
  derived: (items: { source: "business" | "mdna" }[]) => React.ReactNode;
}) {
  if (!section || section.claims.length === 0) return null;
  return (
    <Tile title={section.title} icon={icon} footer={derived(section.claims)}>
      <ul className="grid gap-2.5">
        {section.claims.map((claim, i) => (
          <li key={i} className="flex gap-2.5 text-[13px] text-ink-2 leading-[1.65]">
            <span className="mt-[9px] w-1.5 h-1.5 rounded-full bg-accent shrink-0" aria-hidden />
            <span>{claim.point}</span>
          </li>
        ))}
      </ul>
    </Tile>
  );
}

/** "Derived from Microsoft's Form 10-K filed 2026-07-29 — Item 1 and Item 7 (MD&A)". */
function DerivedFrom({
  profile,
  firm,
  sources,
}: {
  profile: CompanyProfile;
  firm: string;
  sources: ("business" | "mdna")[];
}) {
  const used = new Set(sources);
  const items = [
    used.has("business") ? "Item 1 (Business)" : null,
    used.has("mdna") ? "Item 7 (MD&A)" : null,
  ].filter(Boolean);
  return (
    <p className="text-[11px] text-ink-3 leading-relaxed">
      Derived from {firm}&apos;s{" "}
      <a
        href={profile.filing.url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-accent hover:underline"
      >
        Form 10-K filed {profile.filing.filedDate} ↗
      </a>
      {items.length > 0 ? ` — ${items.join(" and ")}` : ""}
    </p>
  );
}

// ── diagrams ─────────────────────────────────────────────────────

/**
 * Revenue by segment as horizontal bars. Magnitude comparison, so one hue:
 * every bar is the accent colour, lengths run from zero against the largest
 * segment, and the share of the reported total is written beside each so the
 * chart never depends on reading bar lengths alone. Figures are shown exactly
 * as the filing states them.
 */
function SegmentBars({ segments }: { segments: VerifiedSegment[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const total = segments.reduce((sum, s) => sum + s.amount, 0);
  const max = Math.max(...segments.map((s) => s.amount));

  return (
    <div>
      <ul className="grid gap-3.5" aria-label="Revenue by segment">
        {segments.map((seg, i) => {
          const share = (seg.amount / total) * 100;
          const active = hover === i;
          return (
            <li
              key={seg.name}
              className="relative"
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            >
              <div className="flex items-baseline justify-between gap-3 mb-1.5">
                <span className="text-[13px] text-ink font-medium truncate">{seg.name}</span>
                <span className="text-[12px] text-ink-2 font-mono shrink-0">
                  {share.toFixed(share < 10 ? 1 : 0)}%
                </span>
              </div>
              {/* Hit target is the full row; the bar itself stays thin. */}
              <div className="h-2.5 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full bg-accent transition-opacity"
                  style={{
                    width: `${Math.max(1.5, (seg.amount / max) * 100)}%`,
                    opacity: hover === null || active ? 1 : 0.45,
                  }}
                />
              </div>
              {active && (
                <div
                  role="tooltip"
                  className="absolute right-0 -top-9 z-10 bg-ink text-surface text-[11px] rounded-el px-2.5 py-1.5 shadow-md whitespace-nowrap"
                >
                  {seg.amountAsStated} · {share.toFixed(1)}% of segment revenue
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[11px] text-ink-3 mt-3.5 leading-relaxed">
        Share of total reported segment revenue. Hover a bar for the figure as stated in the filing.
      </p>
      <table className="sr-only">
        <caption>Revenue by segment, {segments[0].period}</caption>
        <thead>
          <tr>
            <th>Segment</th>
            <th>Revenue as stated</th>
            <th>Share</th>
          </tr>
        </thead>
        <tbody>
          {segments.map((seg) => (
            <tr key={seg.name}>
              <td>{seg.name}</td>
              <td>{seg.amountAsStated}</td>
              <td>{((seg.amount / total) * 100).toFixed(1)}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** The value chain as a numbered vertical flow: what they make → who pays. */
function ValueChainFlow({ steps }: { steps: VerifiedValueStep[] }) {
  return (
    <ol className="relative">
      {steps.map((step, i) => {
        const last = i === steps.length - 1;
        return (
          <li key={i} className="relative flex gap-3.5 pb-4 last:pb-0">
            {!last && (
              <span
                className="absolute left-[13px] top-7 bottom-0 w-px bg-line-2"
                aria-hidden
              />
            )}
            <span
              className={`relative z-[1] w-[27px] h-[27px] rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                last ? "bg-accent text-surface" : "bg-accent-dim text-accent"
              }`}
            >
              {i + 1}
            </span>
            <div className="pt-0.5 min-w-0">
              <p className="text-[13px] font-semibold text-ink leading-snug">{step.stage}</p>
              <p className="text-[12px] text-ink-2 leading-[1.6] mt-0.5">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── bits ─────────────────────────────────────────────────────────

function Icon({ name }: { name: IconName }) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (name) {
    case "building":
      return (
        <svg {...common}>
          <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
          <path d="M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3" />
        </svg>
      );
    case "money":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
          <path d="M6.5 9.5v.01M17.5 14.5v.01" />
        </svg>
      );
    case "people":
      return (
        <svg {...common}>
          <circle cx="9" cy="8" r="3.2" />
          <path d="M3 20a6 6 0 0 1 12 0M16 11a3 3 0 1 0 0-6M21 20a5 5 0 0 0-4-4.9" />
        </svg>
      );
    case "shield":
      return (
        <svg {...common}>
          <path d="M12 3l7 3v5c0 4.6-3 8.3-7 10-4-1.7-7-5.4-7-10V6z" />
        </svg>
      );
    case "compass":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5l-2 5-5 2 2-5z" />
        </svg>
      );
    case "chart":
      return (
        <svg {...common}>
          <path d="M4 20V4M4 20h16M8 16v-4M12 16V8M16 16v-6" />
        </svg>
      );
    case "flow":
      return (
        <svg {...common}>
          <circle cx="6" cy="6" r="2.5" />
          <circle cx="18" cy="18" r="2.5" />
          <path d="M8.5 6H15a3 3 0 0 1 3 3v6.5" />
        </svg>
      );
  }
}

function LoadingState() {
  return (
    <div>
      <p className="text-[13px] text-ink-2 mb-4">
        Reading the latest annual report…{" "}
        <span className="text-ink-3">
          first time for this company takes about a minute; after that it&apos;s instant until
          they file again.
        </span>
      </p>
      <div className="grid gap-4">
        <div className="bg-surface border border-line rounded-card h-28 animate-pulse" />
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <div key={i} className="bg-surface border border-line rounded-card h-44 animate-pulse" />
          ))}
        </div>
      </div>
    </div>
  );
}
