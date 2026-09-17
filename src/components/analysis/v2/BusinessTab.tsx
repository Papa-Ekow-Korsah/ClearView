"use client";

import { useEffect, useState } from "react";
import {
  PROFILE_FORMAT_VERSION,
  type CompanyProfile,
  type ProfileSection,
  type SectionKey,
  type SourceDocMeta,
  type VerifiedSegment,
  type VerifiedValueStep,
} from "@/types/company-profile";

/**
 * The company profile tab — a long-form read on the business.
 *
 * Loaded on demand rather than with the analysis: a profile is keyed to the
 * filings it was built from, so it's cached server-side and usually returns
 * instantly. Every paragraph and figure passed verification against those
 * filings before it was stored, so each section simply names the documents
 * it was derived from.
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
      <Notice
        title={
          reason === "no-filing"
            ? `No Form 10-K on file for ${ticker}`
            : reason === "unreachable"
              ? "Couldn't reach the SEC"
              : reason === "unparsable"
                ? `Couldn't read ${ticker}'s annual report`
                : "Couldn't build the company profile"
        }
        body={error}
      />
    );
  }

  if (!profile) return null;

  if (profile.formatVersion < PROFILE_FORMAT_VERSION) {
    return (
      <Notice
        title="This profile is being upgraded"
        body="The in-depth version of this company profile, drawing on the latest 10-K, 10-Q and earnings releases, hasn't been built yet. Check back shortly."
      />
    );
  }

  return <ProfileView profile={profile} firm={companyName || profile.companyName} />;
}

// ── layout ───────────────────────────────────────────────────────

function ProfileView({ profile, firm }: { profile: CompanyProfile; firm: string }) {
  const docs = new Map(profile.sources.map((s) => [s.id, s]));
  const sections = profile.sections.filter((s) => s.blocks.length > 0);
  const hasChart = profile.segments.length >= 2;
  const hasFlow = profile.valueChain.length >= 2;

  return (
    <div className="grid gap-5">
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
            <a href={profile.filing.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Form 10-K filed {profile.filing.filedDate} ↗
            </a>
          </figcaption>
        </figure>
      )}

      <nav aria-label="Profile sections" className="flex flex-wrap gap-1.5">
        {sections.map((s) => (
          <a
            key={s.key}
            href={`#profile-${s.key}`}
            className="text-[12px] text-ink-2 bg-surface border border-line rounded-full px-3 py-1 hover:border-accent hover:text-accent transition-colors"
          >
            {s.title}
          </a>
        ))}
      </nav>

      {(hasChart || hasFlow) && (
        <div className={`grid gap-5 ${hasChart && hasFlow ? "lg:grid-cols-2" : ""}`}>
          {hasFlow && (
            <Tile
              title="How the business works"
              icon="flow"
              footer={<DerivedFrom firm={firm} docs={idsToDocs(profile.valueChain.map((v) => v.sourceId), docs)} />}
            >
              <ValueChainFlow steps={profile.valueChain} />
            </Tile>
          )}
          {hasChart && (
            <Tile
              title="Where the revenue comes from"
              subtitle={`Revenue by reportable segment, ${profile.segments[0].period}`}
              icon="chart"
              footer={<DerivedFrom firm={firm} docs={idsToDocs(profile.segments.map((s) => s.sourceId), docs)} />}
            >
              <SegmentBars segments={profile.segments} />
            </Tile>
          )}
        </div>
      )}

      {sections.map((section) => (
        <SectionTile key={section.key} section={section} firm={firm} docs={docs} />
      ))}

      <section className="bg-surface-2 border border-line rounded-card px-5 py-4">
        <h2 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 mb-2.5">
          Sources
        </h2>
        <ul className="grid gap-1.5 mb-3">
          {profile.sources.map((s) => (
            <li key={s.id} className="text-[12px]">
              <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                {s.label} ↗
              </a>
            </li>
          ))}
        </ul>
        <p className="text-[11px] text-ink-3 leading-relaxed">
          Everything on this tab was written from {firm}&apos;s own SEC filings. Each paragraph
          was checked against the passages it was drawn from, and every figure in it had to
          appear in those passages; anything that didn&apos;t hold up was removed before
          publishing
          {profile.discarded > 0 ? ` (${profile.discarded} item${profile.discarded === 1 ? "" : "s"} here)` : ""}.
          Nothing comes from the model&apos;s own knowledge of the company.
        </p>
      </section>
    </div>
  );
}

function idsToDocs(ids: string[], docs: Map<string, SourceDocMeta>): SourceDocMeta[] {
  return [...new Set(ids)].map((id) => docs.get(id)).filter((d): d is SourceDocMeta => !!d);
}

// ── tiles ────────────────────────────────────────────────────────

type IconName =
  | "building" | "box" | "money" | "people" | "shield" | "gear" | "trend" | "compass" | "alert"
  | "chart" | "flow";

const ICON_FOR: Record<SectionKey, IconName> = {
  overview: "building",
  products: "box",
  model: "money",
  customers: "people",
  competition: "shield",
  operations: "gear",
  recent: "trend",
  strategy: "compass",
  risks: "alert",
};

function Tile({
  title,
  subtitle,
  icon,
  footer,
  children,
  id,
}: {
  title: string;
  subtitle?: string;
  icon: IconName;
  footer: React.ReactNode;
  children: React.ReactNode;
  id?: string;
}) {
  return (
    <section id={id} className="bg-surface border border-line rounded-card flex flex-col scroll-mt-4">
      <header className="flex items-center gap-3 px-6 pt-5 pb-3">
        <span className="w-8 h-8 rounded-el bg-accent-dim text-accent flex items-center justify-center shrink-0">
          <Icon name={icon} />
        </span>
        <div className="min-w-0">
          <h2 className="text-[16px] font-semibold leading-tight">{title}</h2>
          {subtitle && <p className="text-[11px] text-ink-3 mt-0.5">{subtitle}</p>}
        </div>
      </header>
      <div className="px-6 pb-5 flex-1">{children}</div>
      <footer className="px-6 py-3 border-t border-line bg-surface-2/60 rounded-b-card">{footer}</footer>
    </section>
  );
}

function SectionTile({
  section,
  firm,
  docs,
}: {
  section: ProfileSection;
  firm: string;
  docs: Map<string, SourceDocMeta>;
}) {
  const cited = idsToDocs(
    section.blocks.flatMap((b) => b.paragraphs.flatMap((p) => p.evidence.map((e) => e.sourceId))),
    docs
  );
  return (
    <Tile
      id={`profile-${section.key}`}
      title={section.title}
      icon={ICON_FOR[section.key]}
      footer={<DerivedFrom firm={firm} docs={cited} />}
    >
      <div className="grid gap-5 max-w-[72ch]">
        {section.blocks.map((block, i) => (
          <div key={i}>
            {block.heading && (
              <h3 className="text-[14px] font-semibold text-ink mb-2">{block.heading}</h3>
            )}
            <div className="grid gap-3">
              {block.paragraphs.map((p, j) => (
                <p key={j} className="text-[14.5px] text-ink-2 leading-[1.8]">
                  {p.text}
                </p>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Tile>
  );
}

/**
 * "Derived from Microsoft's Form 10-K filed 2026-07-29 (Business, MD&A) and
 * earnings release filed 2026-07-29". Sections of one filing are grouped, so
 * the same document isn't named three times in a row.
 */
function DerivedFrom({ firm, docs }: { firm: string; docs: SourceDocMeta[] }) {
  if (docs.length === 0) return null;

  const groups = new Map<string, { name: string; url: string; parts: string[] }>();
  const order: SourceDocMeta["kind"][] = ["10-K", "10-Q", "8-K"];
  for (const d of [...docs].sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind))) {
    const name =
      d.kind === "8-K" ? `earnings release filed ${d.filedDate}` : `Form ${d.kind} filed ${d.filedDate}`;
    const key = `${d.kind}|${d.url}`;
    const group = groups.get(key) ?? { name, url: d.url, parts: [] };
    // Labels read "Form 10-K filed … — Item 7, MD&A"; keep the part after the item number.
    const part = d.label.split(" — ")[1]?.replace(/^Item\s+\w+,\s*/, "");
    if (part && !group.parts.includes(part)) group.parts.push(part);
    groups.set(key, group);
  }
  const list = [...groups.values()];

  return (
    <p className="text-[11px] text-ink-3 leading-relaxed">
      Derived from {firm}&apos;s{" "}
      {list.map((g, i) => (
        <span key={g.url + g.name}>
          {i > 0 && (i === list.length - 1 ? " and " : ", ")}
          <a href={g.url} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
            {g.name}
            {g.parts.length > 0 ? ` (${g.parts.join(", ")})` : ""} ↗
          </a>
        </span>
      ))}
    </p>
  );
}

// ── diagrams ─────────────────────────────────────────────────────

/**
 * Revenue by segment as horizontal bars. Magnitude comparison, so one hue:
 * every bar is the accent colour, lengths run from zero against the largest
 * segment, and each share is written beside its bar so the chart never
 * depends on reading lengths alone. Figures are shown as the filing states them.
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
            {!last && <span className="absolute left-[13px] top-7 bottom-0 w-px bg-line-2" aria-hidden />}
            <span
              className={`relative z-[1] w-[27px] h-[27px] rounded-full flex items-center justify-center text-[11px] font-semibold shrink-0 ${
                last ? "bg-accent text-surface" : "bg-accent-dim text-accent"
              }`}
            >
              {i + 1}
            </span>
            <div className="pt-0.5 min-w-0">
              <p className="text-[13px] font-semibold text-ink leading-snug">{step.stage}</p>
              <p className="text-[12.5px] text-ink-2 leading-[1.6] mt-0.5">{step.detail}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

// ── bits ─────────────────────────────────────────────────────────

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <div className="bg-surface border border-line rounded-card px-5 py-4">
      <p className="text-[13px] font-medium mb-1">{title}</p>
      <p className="text-xs text-ink-2 leading-relaxed">{body}</p>
    </div>
  );
}

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
    case "box":
      return (
        <svg {...common}>
          <path d="M21 8l-9-5-9 5 9 5 9-5zM3 8v8l9 5 9-5V8M12 13v8" />
        </svg>
      );
    case "money":
      return (
        <svg {...common}>
          <rect x="3" y="6" width="18" height="12" rx="2" />
          <circle cx="12" cy="12" r="2.5" />
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
    case "gear":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2v3M12 19v3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M2 12h3M19 12h3M4.9 19.1L7 17M17 7l2.1-2.1" />
        </svg>
      );
    case "trend":
      return (
        <svg {...common}>
          <path d="M3 17l6-6 4 4 8-8M15 7h6v6" />
        </svg>
      );
    case "compass":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M15.5 8.5l-2 5-5 2 2-5z" />
        </svg>
      );
    case "alert":
      return (
        <svg {...common}>
          <path d="M12 3l10 18H2z" />
          <path d="M12 10v5M12 18v.01" />
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
        Reading the latest annual report, quarterly report and earnings releases…{" "}
        <span className="text-ink-3">
          the first time for a company this takes a few minutes; after that it&apos;s instant until
          it files again.
        </span>
      </p>
      <div className="grid gap-5">
        <div className="bg-surface border border-line rounded-card h-28 animate-pulse" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="bg-surface border border-line rounded-card h-56 animate-pulse" />
        ))}
      </div>
    </div>
  );
}
