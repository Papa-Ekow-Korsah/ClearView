"use client";

import { useState } from "react";
import type { ResearchNoteEtf } from "@/types/analysis-etf";
import type { DualText } from "@/types/analysis-v2";
import { useLiveQuote } from "@/components/analysis/v2/useLiveQuote";
import { assessSource } from "@/lib/source-credibility";

type Mode = "explain" | "analyst";
type TabId = "overview" | "performance" | "holdings" | "macro" | "verdict";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "performance", label: "Performance" },
  { id: "holdings", label: "Holdings & Costs" },
  { id: "macro", label: "Macro" },
  { id: "verdict", label: "Verdict" },
];

function pick(d: DualText, mode: Mode): string {
  return mode === "explain" ? d.explain : d.analyst;
}

function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(digits)}%`;
}

const SIGNAL_STYLE = {
  BUY: { badge: "bg-pos-bg text-pos border-pos-bdr", icon: "▲" },
  HOLD: { badge: "bg-warn-bg text-warn border-warn-bdr", icon: "▬" },
  SELL: { badge: "bg-neg-bg text-neg border-neg-bdr", icon: "▼" },
} as const;

const TONE = {
  ok: { text: "text-pos", solid: "var(--green)" },
  warn: { text: "text-neg", solid: "var(--red)" },
  watch: { text: "text-warn", solid: "var(--amber)" },
  neutral: { text: "text-ink-3", solid: "var(--text3)" },
} as const;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 mb-3 pb-2 border-b border-line">
      {children}
    </h2>
  );
}

function ComputedTag() {
  return (
    <span
      title="Calculated by ClearView from the fund's actual daily closing prices. No AI involvement."
      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-teal bg-teal-bg rounded px-1.5 py-0.5"
    >
      ✓ Computed from prices
    </span>
  );
}

function SourceCite({ url }: { url: string | null }) {
  if (!url) return null;
  const { domain, tier, note } = assessSource(url);
  if (!domain) return null;
  const style =
    tier === "caution" ? "bg-warn-bg text-warn font-medium" : "bg-surface-2 text-ink-3";
  const prefix =
    tier === "caution" ? "⚠ unverified source: " : tier === "aggregator" ? "via " : "";
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={note}
      className={`inline-flex items-center gap-1 text-[10px] rounded px-1.5 py-0.5 hover:underline ${style}`}
    >
      {prefix}
      {domain}
      {tier === "aggregator" ? " (aggregator)" : ""} ↗
    </a>
  );
}

function factOf(note: ResearchNoteEtf, field: string) {
  return note.retrieved?.facts?.find((f) => f.field === field && f.url) ?? null;
}

export function EtfNoteView({ note }: { note: ResearchNoteEtf }) {
  const [tab, setTab] = useState<TabId>("overview");
  const [mode, setMode] = useState<Mode>("explain");
  const { ai, snapshot } = note;
  const live = useLiveQuote(note.ticker);
  const price = live?.price ?? snapshot.price;
  const changePct = live?.changePct ?? snapshot.dayChangePct;
  const up = (changePct ?? 0) >= 0;

  return (
    <div className="flex-1 flex flex-col">
      <div className="bg-surface border-b border-line px-5 sm:px-7 pt-5">
        <div className="max-w-5xl mx-auto w-full">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
            <div>
              <p className="text-xs text-ink-3 mb-0.5">
                {note.companyName}
                {snapshot.exchange ? ` · ${snapshot.exchange}` : ""}
                <span className="ml-2 text-[10px] font-semibold uppercase tracking-wide text-accent bg-accent-dim rounded px-1.5 py-0.5">
                  ETF
                </span>
              </p>
              <h1 className="text-3xl font-semibold font-mono tracking-tight leading-none">
                {note.ticker}
              </h1>
            </div>
            <div className="flex items-start gap-5">
              <div className="text-right">
                <p className="text-3xl font-semibold font-mono tracking-tight leading-none">
                  {price !== null ? `$${price.toFixed(2)}` : "—"}
                </p>
                <p className={`text-xs mt-1 font-medium ${up ? "text-pos" : "text-neg"}`}>
                  {changePct !== null ? `${pct(changePct, 2)} today` : ""}
                </p>
                {live && (
                  <p className="text-[10px] mt-1 flex items-center justify-end gap-1.5">
                    <span className="w-[7px] h-[7px] rounded-full bg-pos animate-pulse" />
                    <span className="text-pos font-medium">Live</span>
                  </p>
                )}
              </div>
              <div className="flex bg-surface-2 border border-line rounded-full p-[3px] shrink-0">
                {(["explain", "analyst"] as const).map((m) => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-4 py-1 rounded-full text-xs font-medium transition-all ${
                      mode === m
                        ? `bg-surface border border-line shadow-sm ${m === "explain" ? "text-teal" : "text-ink"}`
                        : "text-ink-2"
                    }`}
                  >
                    {m === "explain" ? "Explain" : "Analyst"}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/*
            No signal badge here — same reason as the company view. A
            BUY/HOLD/SELL beside the live price reads as a standing
            instruction; the call belongs in the Verdict tab with its
            evidence.
          */}
          <div className="mb-4">
            <p className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 mb-1">
              What the analysis found
            </p>
            <p className="text-[13px] text-ink-2 leading-relaxed max-w-3xl">
              {ai.signalReason}
            </p>
          </div>

          <nav className="flex border-t border-line overflow-x-auto -mx-1" aria-label="Fund sections">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-4 sm:px-5 py-3 text-[13px] font-medium whitespace-nowrap border-b-2 transition-colors ${
                  tab === t.id
                    ? "text-accent border-accent"
                    : "text-ink-2 border-transparent hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <div className="flex-1 px-5 sm:px-7 py-6">
        <div className="max-w-5xl mx-auto w-full">
          {tab === "overview" && <Overview note={note} mode={mode} />}
          {tab === "performance" && <Performance note={note} mode={mode} />}
          {tab === "holdings" && <Holdings note={note} mode={mode} />}
          {tab === "macro" && <Macro note={note} mode={mode} />}
          {tab === "verdict" && <Verdict note={note} mode={mode} />}

          <p className="text-[11px] text-ink-3 mt-7 pt-3 border-t border-line leading-relaxed">
            Performance and risk figures are computed by ClearView from this
            fund&apos;s actual daily closing prices. Holdings and costs are
            retrieved from the cited sources. Narrative is generated by{" "}
            {note.model}. Generated{" "}
            {new Date(note.generatedAt).toLocaleString("en-GB", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
            . Not investment advice — always do your own research.
          </p>
        </div>
      </div>
    </div>
  );
}

function Overview({ note, mode }: { note: ResearchNoteEtf; mode: Mode }) {
  const { ai, snapshot } = note;
  const index = factOf(note, "INDEX_TRACKED");
  const expense = factOf(note, "EXPENSE_RATIO");
  const oneYear = snapshot.performance.windows.find((w) => w.days === 365);

  return (
    <div>
      <SectionLabel>What this fund is</SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5 mb-6">
        <p className="text-sm text-ink-2 leading-[1.8] mb-3">
          {pick(ai.overview.whatItTracks, mode)}
        </p>
        {index && (
          <div className="flex items-center gap-2 flex-wrap pt-3 border-t border-line">
            <span className="text-[11px] text-ink-3">Tracks:</span>
            <span className="text-[13px] font-medium">{index.value}</span>
            <SourceCite url={index.url} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6">
        <Stat label="1-year return" value={pct(oneYear?.fundPct ?? null)} computed />
        <Stat
          label="Volatility (ann.)"
          value={pct(snapshot.performance.annualisedVolPct)}
          computed
        />
        <Stat
          label="Beta vs S&P"
          value={
            snapshot.performance.betaVsBenchmark === null
              ? "—"
              : snapshot.performance.betaVsBenchmark.toFixed(2)
          }
          computed
        />
        {expense ? (
          <div className="bg-surface border border-line rounded-el px-3.5 py-3">
            <p className="text-[11px] text-ink-3 mb-1">Expense ratio</p>
            <p className="text-lg font-semibold font-mono mb-1.5">{expense.value}</p>
            <SourceCite url={expense.url} />
          </div>
        ) : (
          <Stat label="Expense ratio" value="Not sourced" />
        )}
      </div>

      <SectionLabel>Portfolio role</SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5 mb-6">
        <p className="text-sm text-ink-2 leading-[1.8]">
          {pick(ai.overview.suitability, mode)}
        </p>
      </div>

      <SectionLabel>Bull vs bear</SectionLabel>
      <BullBear bull={ai.overview.bullCase} bear={ai.overview.bearCase} />
    </div>
  );
}

function Stat({
  label,
  value,
  computed,
}: {
  label: string;
  value: string;
  computed?: boolean;
}) {
  return (
    <div className="bg-surface border border-line rounded-el px-3.5 py-3">
      <p className="text-[11px] text-ink-3 mb-1">{label}</p>
      <p className="text-lg font-semibold font-mono">{value}</p>
      {computed && (
        <p className="mt-1.5">
          <ComputedTag />
        </p>
      )}
    </div>
  );
}

function BullBear({ bull, bear }: { bull: string[]; bear: string[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="bg-surface border border-pos-bdr rounded-el p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-pos mb-2">
          Bull case
        </h3>
        {bull.map((p, i) => (
          <p
            key={i}
            className="text-xs text-ink-2 py-1.5 pl-3.5 relative border-b border-line last:border-b-0 leading-relaxed before:content-[''] before:absolute before:left-0 before:top-3 before:w-[5px] before:h-[5px] before:rounded-full before:bg-pos"
          >
            {p}
          </p>
        ))}
      </div>
      <div className="bg-surface border border-neg-bdr rounded-el p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neg mb-2">
          Bear case
        </h3>
        {bear.map((p, i) => (
          <p
            key={i}
            className="text-xs text-ink-2 py-1.5 pl-3.5 relative border-b border-line last:border-b-0 leading-relaxed before:content-[''] before:absolute before:left-0 before:top-3 before:w-[5px] before:h-[5px] before:rounded-full before:bg-neg"
          >
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}

function Performance({ note, mode }: { note: ResearchNoteEtf; mode: Mode }) {
  const p = note.snapshot.performance;
  return (
    <div>
      <SectionLabel>
        Performance vs {p.benchmark}{" "}
        <span className="normal-case tracking-normal">
          <ComputedTag />
        </span>
      </SectionLabel>

      <div className="bg-surface border border-line rounded-card overflow-hidden mb-5">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-3 border-b border-line">
                <th className="text-left font-medium px-4 py-2.5">Period</th>
                <th className="text-right font-medium px-3 py-2.5">This fund</th>
                <th className="text-right font-medium px-3 py-2.5">{p.benchmark}</th>
                <th className="text-right font-medium px-4 py-2.5">Difference</th>
              </tr>
            </thead>
            <tbody>
              {p.windows.map((w) => (
                <tr key={w.days} className="border-b border-line last:border-b-0">
                  <td className="px-4 py-2.5">{w.label}</td>
                  <td
                    className={`text-right font-mono px-3 py-2.5 ${
                      w.fundPct === null ? "text-ink-3" : w.fundPct >= 0 ? "text-pos" : "text-neg"
                    }`}
                  >
                    {w.fundPct === null ? "no history" : pct(w.fundPct)}
                  </td>
                  <td className="text-right font-mono px-3 py-2.5 text-ink-2">
                    {pct(w.benchmarkPct)}
                  </td>
                  <td
                    className={`text-right font-mono px-4 py-2.5 font-semibold ${
                      w.alphaPct === null ? "text-ink-3" : w.alphaPct >= 0 ? "text-pos" : "text-neg"
                    }`}
                  >
                    {w.alphaPct === null ? "—" : pct(w.alphaPct)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-5">
        <Stat label="Annualised volatility" value={pct(p.annualisedVolPct)} computed />
        <Stat label="Maximum drawdown" value={pct(p.maxDrawdownPct)} computed />
        <Stat
          label={`Beta vs ${p.benchmark}`}
          value={p.betaVsBenchmark === null ? "—" : p.betaVsBenchmark.toFixed(2)}
          computed
        />
      </div>

      <p className="text-[11px] text-ink-3 mb-5">
        Computed from {p.observations} daily closes
        {p.from && p.to ? `, ${p.from} to ${p.to}` : ""}. A period showing &ldquo;no
        history&rdquo; is longer than this fund has been trading.
      </p>

      <SectionLabel>What the numbers say</SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5">
        <p className="text-sm text-ink-2 leading-[1.8]">
          {pick(note.ai.performanceCommentary, mode)}
        </p>
      </div>
    </div>
  );
}

function Holdings({ note, mode }: { note: ResearchNoteEtf; mode: Mode }) {
  const top = factOf(note, "TOP_HOLDINGS");
  const aum = factOf(note, "FUND_AUM");
  const expense = factOf(note, "EXPENSE_RATIO");

  return (
    <div>
      <SectionLabel>Top holdings</SectionLabel>
      {top ? (
        <div className="bg-surface border border-line rounded-card p-5 mb-6">
          <p className="text-[13px] text-ink-2 leading-relaxed mb-3">{top.value}</p>
          <SourceCite url={top.url} />
        </div>
      ) : (
        <div className="bg-surface-2 border border-line rounded-card px-4 py-3 mb-6">
          <p className="text-xs text-ink-2 leading-relaxed">
            Holdings could not be sourced from a citable page. Rather than list
            positions from memory, none are shown — check the issuer&apos;s own
            fund page for the current basket.
          </p>
        </div>
      )}

      <SectionLabel>Concentration</SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5 mb-6">
        <p className="text-sm text-ink-2 leading-[1.8]">
          {pick(note.ai.holdings.concentration, mode)}
        </p>
      </div>

      <SectionLabel>What actually drives this fund</SectionLabel>
      <div className="grid gap-2.5 mb-6">
        {note.ai.holdings.keyExposures.map((e, i) => (
          <div key={i} className="bg-surface border border-line rounded-card px-4 py-3.5">
            <h3 className="text-[13px] font-medium mb-1">{e.name}</h3>
            <p className="text-xs text-ink-2 leading-relaxed">{e.why}</p>
          </div>
        ))}
      </div>

      <SectionLabel>Cost and structure</SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5">
        <div className="flex gap-6 flex-wrap mb-3">
          <div>
            <p className="text-[11px] text-ink-3 mb-0.5">Expense ratio</p>
            <p className="text-[15px] font-semibold font-mono">
              {expense ? expense.value : "Not sourced"}
            </p>
            {expense && <div className="mt-1"><SourceCite url={expense.url} /></div>}
          </div>
          <div>
            <p className="text-[11px] text-ink-3 mb-0.5">Assets under management</p>
            <p className="text-[15px] font-semibold font-mono">
              {aum ? aum.value : "Not sourced"}
            </p>
            {aum && <div className="mt-1"><SourceCite url={aum.url} /></div>}
          </div>
          {note.snapshot.firstTradeDate && (
            <div>
              <p className="text-[11px] text-ink-3 mb-0.5">Trading since</p>
              <p className="text-[15px] font-semibold font-mono">
                {note.snapshot.firstTradeDate}
              </p>
            </div>
          )}
        </div>
        <p className="text-sm text-ink-2 leading-[1.8] pt-3 border-t border-line">
          {pick(note.ai.costs, mode)}
        </p>
      </div>
    </div>
  );
}

const IMPACT_STYLE = {
  tailwind: "bg-pos-bg text-pos",
  headwind: "bg-neg-bg text-neg",
  mixed: "bg-warn-bg text-warn",
  neutral: "bg-surface-2 text-ink-2",
} as const;

function Macro({ note, mode }: { note: ResearchNoteEtf; mode: Mode }) {
  const m = note.ai.macro;
  return (
    <div>
      <div className="bg-surface border border-line rounded-card p-4 mb-5">
        <p className="text-[13px] text-ink-2 leading-[1.7]">{pick(m.summary, mode)}</p>
      </div>
      <SectionLabel>Macro factors reaching this fund</SectionLabel>
      <div className="grid sm:grid-cols-2 gap-2.5 mb-5">
        {m.factors.map((f, i) => (
          <div key={i} className="bg-surface border border-line rounded-card overflow-hidden">
            <div className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-line">
              <div>
                <p className="text-[13px] font-medium">{f.name}</p>
                <p className="text-[11px] text-ink-3 mt-0.5">{f.reading}</p>
              </div>
              <span
                className={`text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${IMPACT_STYLE[f.impact]}`}
              >
                {f.impactLabel}
              </span>
            </div>
            <div className="px-4 py-3">
              <p className="text-[13px] text-ink-2 leading-[1.7]">{pick(f.body, mode)}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="bg-surface border border-line rounded-card p-4">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[13px] font-medium">Overall macro backdrop</p>
          <p className="text-[13px] font-medium">{m.netImpact.label}</p>
        </div>
        <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full"
            style={{
              width: `${Math.min(100, Math.max(2, m.netImpact.barPct))}%`,
              background:
                m.netImpact.direction === "tailwind"
                  ? "var(--green)"
                  : m.netImpact.direction === "headwind"
                    ? "var(--red)"
                    : "var(--amber)",
            }}
          />
        </div>
      </div>
    </div>
  );
}

const CONV = {
  low: { pct: 25, color: "var(--red)", text: "text-neg" },
  medium: { pct: 52, color: "var(--amber)", text: "text-warn" },
  high: { pct: 82, color: "var(--green)", text: "text-pos" },
} as const;

function Verdict({ note, mode }: { note: ResearchNoteEtf; mode: Mode }) {
  const v = note.ai.verdict;
  const sig = SIGNAL_STYLE[note.ai.signal];
  const conv = CONV[note.ai.conviction];

  return (
    <div>
      <SectionLabel>
        {mode === "explain" ? "Verdict — plain English" : "Verdict — analyst view"}
      </SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5 mb-5">
        <div className="flex items-start gap-4 mb-4 flex-wrap sm:flex-nowrap">
          <div
            className={`w-20 h-20 rounded-card border flex flex-col items-center justify-center gap-1 shrink-0 ${sig.badge}`}
          >
            <span className="text-xl" aria-hidden>{sig.icon}</span>
            <span className="text-xs font-semibold tracking-wide">{note.ai.signal}</span>
          </div>
          <div>
            <p className="text-sm text-ink-2 leading-[1.8]">{pick(v.text, mode)}</p>
            {/*
              Funds have no street rating to cite, so the framing names what
              the call actually rests on here: computed returns and risk, the
              cost of holding it, and what it's exposed to.
            */}
            <p className="text-[11px] text-ink-3 leading-relaxed mt-2.5">
              This {note.ai.signal} is where the evidence in this note points:
              the returns and risk computed from this fund&apos;s own closing
              prices, its cost, and what it actually holds, taken together. It
              describes what the analysis supports, not what you should do with
              your money.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-3.5 border-t border-line flex-wrap">
          <span className="text-xs text-ink-3 shrink-0">Analysis conviction</span>
          <div className="flex-1 h-[5px] bg-surface-2 rounded-full overflow-hidden min-w-[80px]">
            <div className="h-full rounded-full" style={{ width: `${conv.pct}%`, background: conv.color }} />
          </div>
          <span className={`text-xs font-medium capitalize shrink-0 ${conv.text}`}>
            {note.ai.conviction}
          </span>
          <span className="text-[11px] text-ink-3 w-full sm:w-auto">— {note.ai.convictionNote}</span>
        </div>
      </div>

      <SectionLabel>Scorecard</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-5">
        {v.scorecard.map((s, i) => (
          <div key={i} className="bg-surface border border-line rounded-card p-4">
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold">{s.name}</p>
              <span className={`flex items-center gap-1.5 text-xs font-medium ${TONE[s.tone].text}`}>
                <span className="w-[7px] h-[7px] rounded-full" style={{ background: TONE[s.tone].solid }} />
                {s.rating}
              </span>
            </div>
            <p className="text-xs text-ink-2 leading-[1.65]">{pick(s.desc, mode)}</p>
          </div>
        ))}
      </div>

      <SectionLabel>Research recommendation</SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5">
        <p className="text-[13px] text-ink-2 leading-[1.8] mb-4">
          {pick(v.recommendation.text, mode)}
        </p>
        <div className="bg-surface-2 rounded-el px-4 py-3">
          <p className="text-[11px] text-ink-3 leading-relaxed">
            <span className="font-medium text-ink-2">Research note:</span> ClearView
            generates data-driven research positions from public information. This is
            not personalised investment advice and does not account for your financial
            situation, risk tolerance, or objectives.
          </p>
        </div>
      </div>
    </div>
  );
}
