"use client";

import { useState } from "react";
import type {
  AiNoteV2,
  DualText,
  RatioKey,
  ResearchNoteV2,
} from "@/types/analysis-v2";
import { useLiveQuote, type LiveData } from "@/components/analysis/v2/useLiveQuote";

type Mode = "explain" | "analyst";
type TabId = "overview" | "earnings" | "ratios" | "deals" | "macro" | "verdict";

const TABS: { id: TabId; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "earnings", label: "Earnings" },
  { id: "ratios", label: "Ratios" },
  { id: "deals", label: "Deals & Contracts" },
  { id: "macro", label: "Macro" },
  { id: "verdict", label: "Verdict" },
];

const RATIO_SUFFIX: Record<RatioKey, string> = {
  peTTM: "x",
  evEbitdaTTM: "x",
  psTTM: "x",
  roeTTM: "%",
  debtToEquity: "x",
  currentRatio: "",
};

// ── shared bits ──────────────────────────────────────────────────

function pick(d: DualText, mode: Mode): string {
  return mode === "explain" ? d.explain : d.analyst;
}

function fmtCap(millions: number | null): string {
  if (millions === null) return "—";
  if (millions >= 1_000_000) return `$${(millions / 1_000_000).toFixed(2)}T`;
  if (millions >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`;
  return `$${millions.toFixed(0)}M`;
}

const TONE = {
  ok: { text: "text-pos", bg: "bg-pos-bg", bdr: "border-pos-bdr", solid: "var(--green)" },
  warn: { text: "text-neg", bg: "bg-neg-bg", bdr: "border-neg-bdr", solid: "var(--red)" },
  watch: { text: "text-warn", bg: "bg-warn-bg", bdr: "border-warn-bdr", solid: "var(--amber)" },
  neutral: { text: "text-ink-3", bg: "bg-surface-2", bdr: "border-line", solid: "var(--text3)" },
} as const;

const SIGNAL_STYLE: Record<AiNoteV2["signal"], { badge: string; icon: string }> = {
  BUY: { badge: "bg-pos-bg text-pos border-pos-bdr", icon: "▲" },
  HOLD: { badge: "bg-warn-bg text-warn border-warn-bdr", icon: "▬" },
  SELL: { badge: "bg-neg-bg text-neg border-neg-bdr", icon: "▼" },
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 mb-3 pb-2 border-b border-line">
      {children}
    </h2>
  );
}

function AiSourcedTag() {
  return (
    <span
      title="Figures in this section come from the AI model's knowledge and recent news, not verified market data."
      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-ink-3 bg-surface-2 border border-line rounded px-1.5 py-0.5"
    >
      AI-sourced
    </span>
  );
}

function VerifiedTag() {
  return (
    <span
      title="Figures in this section come directly from market data APIs."
      className="inline-flex items-center gap-1 text-[9px] font-semibold uppercase tracking-wide text-teal bg-teal-bg rounded px-1.5 py-0.5"
    >
      ✓ Verified data
    </span>
  );
}

function Panel({
  title,
  tag,
  children,
}: {
  title: string;
  tag?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-surface border border-line rounded-el p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[10px] font-semibold tracking-[0.06em] uppercase text-ink-3">
          {title}
        </h3>
        {tag}
      </div>
      {children}
    </div>
  );
}

// ── main component ───────────────────────────────────────────────

export function TabbedNoteView({ note }: { note: ResearchNoteV2 }) {
  const [tab, setTab] = useState<TabId>("overview");
  const [mode, setMode] = useState<Mode>("explain");
  const { ai, snapshot } = note;
  const sig = SIGNAL_STYLE[ai.signal];
  const live = useLiveQuote(note.ticker);
  const price = live?.price ?? snapshot.price;
  const changePct = live?.changePct ?? snapshot.dayChangePct;
  const dayPos = (changePct ?? 0) >= 0;

  return (
    <div className="flex-1 flex flex-col">
      {/* Stock header */}
      <div className="bg-surface border-b border-line px-5 sm:px-7 pt-5">
        <div className="max-w-5xl mx-auto w-full">
          <div className="flex items-start justify-between gap-4 flex-wrap mb-3">
            <div>
              <p className="text-xs text-ink-3 mb-0.5">
                {note.companyName}
                {snapshot.exchange ? ` · ${snapshot.exchange}` : ""}
                {snapshot.industry ? ` · ${snapshot.industry}` : ""}
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
                <p className={`text-xs mt-1 font-medium ${dayPos ? "text-pos" : "text-neg"}`}>
                  {changePct !== null
                    ? `${dayPos ? "+" : ""}${changePct.toFixed(2)}% today`
                    : ""}
                </p>
                <p className="text-[10px] mt-1 flex items-center justify-end gap-1.5">
                  {live ? (
                    <>
                      <span className="w-[7px] h-[7px] rounded-full bg-pos animate-pulse" />
                      <span className="text-pos font-medium">Live</span>
                    </>
                  ) : (
                    <span className="text-ink-3">
                      as of {new Date(note.generatedAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short" })}
                    </span>
                  )}
                </p>
              </div>
              <ModeToggle mode={mode} setMode={setMode} />
            </div>
          </div>

          <div className="flex items-center gap-3.5 mb-4 flex-wrap">
            <span
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-card text-sm font-semibold border shrink-0 ${sig.badge}`}
            >
              <span aria-hidden>{sig.icon}</span> {ai.signal}
            </span>
            <p className="text-[13px] text-ink-2 leading-relaxed flex-1 min-w-[240px]">
              {ai.signalReason}
            </p>
          </div>

          <nav className="flex border-t border-line overflow-x-auto -mx-1" aria-label="Analysis sections">
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

      {/* Tab content */}
      <div className="flex-1 px-5 sm:px-7 py-6">
        <div className="max-w-5xl mx-auto w-full">
          {tab === "overview" && <OverviewTab note={note} mode={mode} />}
          {tab === "earnings" && <EarningsTab note={note} mode={mode} />}
          {tab === "ratios" && <RatiosTab note={note} mode={mode} live={live} />}
          {tab === "deals" && <DealsTab note={note} mode={mode} />}
          {tab === "macro" && <MacroTab note={note} mode={mode} />}
          {tab === "verdict" && <VerdictTab note={note} mode={mode} />}

          <p className="text-[11px] text-ink-3 mt-7 pt-3 border-t border-line leading-relaxed">
            Market data from Finnhub; sections marked “AI-sourced” are generated by{" "}
            {note.model} from public knowledge and recent news. Generated{" "}
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

function ModeToggle({ mode, setMode }: { mode: Mode; setMode: (m: Mode) => void }) {
  return (
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
  );
}

// ── Overview ─────────────────────────────────────────────────────

function OverviewTab({ note, mode }: { note: ResearchNoteV2; mode: Mode }) {
  void mode;
  const { ai, snapshot } = note;
  return (
    <div>
      <SectionLabel>At a glance</SectionLabel>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-6">
        <MetricCard label="Price" value={snapshot.price !== null ? `$${snapshot.price.toFixed(2)}` : "—"} />
        <MetricCard label="Market cap" value={fmtCap(snapshot.marketCap)} />
        <MetricCard label="Signal" value={ai.signal} />
        <MetricCard label="Street consensus" value={ai.overview.analystConsensus} small aiSourced />
      </div>

      {ai.overview.recentMoves.length > 0 && (
        <>
          <SectionLabel>
            Recent analyst moves <span className="normal-case tracking-normal ml-1"><AiSourcedTag /></span>
          </SectionLabel>
          <div className="bg-surface border border-line rounded-card px-4 py-1 mb-6">
            {ai.overview.recentMoves.map((m, i) => (
              <p key={i} className="text-[13px] text-ink-2 py-2.5 border-b border-line last:border-b-0 leading-relaxed">
                {m}
              </p>
            ))}
          </div>
        </>
      )}

      <SectionLabel>Bull vs bear</SectionLabel>
      <BullBear bull={ai.overview.bullCase} bear={ai.overview.bearCase} />
    </div>
  );
}

function MetricCard({
  label,
  value,
  small,
  aiSourced,
}: {
  label: string;
  value: string;
  small?: boolean;
  aiSourced?: boolean;
}) {
  return (
    <div className="bg-surface border border-line rounded-el px-3.5 py-3">
      <p className="text-[11px] text-ink-3 mb-1 flex items-center gap-1.5">
        {label} {aiSourced && <AiSourcedTag />}
      </p>
      <p className={`font-semibold font-mono ${small ? "text-[13px]" : "text-lg"}`}>{value}</p>
    </div>
  );
}

function BullBear({ bull, bear }: { bull: string[]; bear: string[] }) {
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <div className="bg-surface border border-pos-bdr rounded-el p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-pos mb-2">Bull case</h3>
        {bull.map((p, i) => (
          <p key={i} className="text-xs text-ink-2 py-1.5 pl-3.5 relative border-b border-line last:border-b-0 leading-relaxed before:content-[''] before:absolute before:left-0 before:top-3 before:w-[5px] before:h-[5px] before:rounded-full before:bg-pos">
            {p}
          </p>
        ))}
      </div>
      <div className="bg-surface border border-neg-bdr rounded-el p-4">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-neg mb-2">Bear case</h3>
        {bear.map((p, i) => (
          <p key={i} className="text-xs text-ink-2 py-1.5 pl-3.5 relative border-b border-line last:border-b-0 leading-relaxed before:content-[''] before:absolute before:left-0 before:top-3 before:w-[5px] before:h-[5px] before:rounded-full before:bg-neg">
            {p}
          </p>
        ))}
      </div>
    </div>
  );
}

// ── Earnings ─────────────────────────────────────────────────────

function usd(v: number | null): string {
  if (v === null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e12) return `$${(v / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${v.toFixed(0)}`;
}

function pct(numerator: number | null, denominator: number | null): number | null {
  if (numerator === null || denominator === null || denominator === 0) return null;
  return (numerator / denominator) * 100;
}

function EarningsTab({ note, mode }: { note: ResearchNoteV2; mode: Mode }) {
  const e = note.ai.earnings;
  const sec = note.secFinancials ?? null;
  const latestEps = note.epsSurprises[0];
  const beat = (latestEps?.surprisePercent ?? 0) >= 0;

  return (
    <div>
      <div
        className={`flex items-start gap-3 rounded-el px-4 py-3 mb-5 border ${
          beat ? "bg-pos-bg border-pos-bdr" : "bg-neg-bg border-neg-bdr"
        }`}
      >
        <span className={`text-lg leading-none mt-0.5 ${beat ? "text-pos" : "text-neg"}`} aria-hidden>
          {beat ? "🏆" : "▽"}
        </span>
        <p className={`text-xs leading-relaxed ${beat ? "text-pos" : "text-neg"}`}>
          {pick(e.beatBanner, mode)}
        </p>
      </div>

      <SectionLabel>
        {e.period} — {e.reportDate}
      </SectionLabel>

      <div className="grid sm:grid-cols-3 gap-2.5 mb-5">
        <div className="bg-surface border border-line rounded-el border-t-2 border-t-accent px-3.5 py-3">
          <p className="text-[10px] text-ink-3 mb-1 flex items-center gap-1.5">
            Revenue {sec?.incomeStatement.revenue != null ? <VerifiedTag /> : <AiSourcedTag />}
          </p>
          <p className="text-xl font-semibold font-mono leading-none mb-1.5">
            {sec?.incomeStatement.revenue != null ? usd(sec.incomeStatement.revenue) : e.revenue.value}
          </p>
          <p className="text-[10px] text-ink-3">
            Est. {e.revenue.estimate}{" "}
            <span className="text-pos font-semibold">{e.revenue.beat}</span>
          </p>
          <p className="text-[10px] text-pos mt-0.5">
            {sec?.incomeStatement.revenueYoYPct != null
              ? `${sec.incomeStatement.revenueYoYPct >= 0 ? "+" : ""}${sec.incomeStatement.revenueYoYPct.toFixed(1)}%`
              : e.revenue.yoy}{" "}
            YoY
          </p>
        </div>
        {note.epsSurprises.slice(0, 2).map((s, i) => {
          const b = (s.surprisePercent ?? 0) >= 0;
          return (
            <div
              key={i}
              className={`bg-surface border border-line rounded-el border-t-2 px-3.5 py-3 ${b ? "border-t-pos" : "border-t-neg"}`}
            >
              <p className="text-[10px] text-ink-3 mb-1 flex items-center gap-1.5">
                EPS {s.period} <VerifiedTag />
              </p>
              <p className="text-xl font-semibold font-mono leading-none mb-1.5">
                {s.actual != null ? `$${s.actual.toFixed(2)}` : "—"}
              </p>
              <p className="text-[10px] text-ink-3">
                Est. {s.estimate != null ? `$${s.estimate.toFixed(2)}` : "—"}{" "}
                <span className={`font-semibold px-1.5 py-0.5 rounded ${b ? "bg-pos-bg text-pos" : "bg-neg-bg text-neg"}`}>
                  {s.surprisePercent != null
                    ? `${b ? "Beat" : "Miss"} ${s.surprisePercent > 0 ? "+" : ""}${s.surprisePercent.toFixed(1)}%`
                    : "—"}
                </span>
              </p>
            </div>
          );
        })}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <Panel title="Segment revenue" tag={<AiSourcedTag />}>
          {e.segments.map((s, i) => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-line last:border-b-0 gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-ink-2 mb-1">{s.name}</p>
                <div className="h-[3px] bg-surface-2 rounded-full overflow-hidden w-[92%]">
                  <div
                    className="h-full rounded-full bg-accent"
                    style={{ width: `${Math.min(100, Math.max(3, s.barPct))}%` }}
                  />
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold font-mono">{s.revenue}</p>
                <p className={`text-[10px] ${s.growth.startsWith("-") ? "text-neg" : "text-pos"}`}>{s.growth}</p>
              </div>
            </div>
          ))}
        </Panel>
        {sec?.incomeStatement.revenue != null ? (
          <Panel title={`Margins — ${sec.fiscalPeriod}`} tag={<VerifiedTag />}>
            {(
              [
                ["Gross margin", pct(sec.incomeStatement.grossProfit, sec.incomeStatement.revenue)],
                ["Operating margin", pct(sec.incomeStatement.operatingIncome, sec.incomeStatement.revenue)],
                ["Net margin", pct(sec.incomeStatement.netIncome, sec.incomeStatement.revenue)],
                ["FCF margin", pct(sec.cashFlow.freeCashFlow, sec.incomeStatement.revenue)],
              ] as const
            )
              .filter(([, v]) => v !== null)
              .map(([name, v], i) => (
                <div key={i} className="py-2 border-b border-line last:border-b-0">
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[11px] text-ink-2">{name}</span>
                    <span className={`text-xs font-semibold font-mono ${v! >= 0 ? "text-pos" : "text-neg"}`}>
                      {v!.toFixed(1)}%
                    </span>
                  </div>
                  <div className="h-[3px] bg-surface-2 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(100, Math.max(3, Math.abs(v!)))}%`,
                        background: v! >= 0 ? "var(--green)" : "var(--red)",
                      }}
                    />
                  </div>
                </div>
              ))}
          </Panel>
        ) : (
          <Panel title="Margins" tag={<AiSourcedTag />}>
            {e.margins.map((m, i) => (
              <div key={i} className="py-2 border-b border-line last:border-b-0">
                <div className="flex justify-between items-center mb-1">
                  <span className="text-[11px] text-ink-2">{m.name}</span>
                  <span className={`text-xs font-semibold font-mono ${TONE[m.tone].text}`}>{m.value}</span>
                </div>
                <div className="h-[3px] bg-surface-2 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.max(3, m.barPct))}%`,
                      background: TONE[m.tone].solid,
                    }}
                  />
                </div>
                <p className="text-[10px] text-ink-3 mt-1">{m.yoyNote}</p>
              </div>
            ))}
          </Panel>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        {sec ? (
          <Panel title={`Balance sheet — ${sec.fiscalPeriod}`} tag={<VerifiedTag />}>
            {(
              [
                ["Cash & equivalents", sec.balanceSheet.cash, "bg-pos"],
                ["Short-term investments", sec.balanceSheet.shortTermInvestments, "bg-pos"],
                ["Total assets", sec.balanceSheet.totalAssets, "bg-accent"],
                ["Total liabilities", sec.balanceSheet.totalLiabilities, "bg-neg"],
                ["Shareholders' equity", sec.balanceSheet.equity, "bg-pos"],
                ["Long-term debt", sec.balanceSheet.longTermDebt, "bg-warn"],
              ] as const
            )
              .filter(([, v]) => v !== null)
              .map(([label, value, dot], i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-line last:border-b-0">
                  <span className="flex items-center gap-2 text-[11px] text-ink-2">
                    <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                    {label}
                  </span>
                  <span className="text-xs font-semibold font-mono">{usd(value)}</span>
                </div>
              ))}
            {sec.balanceSheet.netDebt !== null && (
              <div
                className={`flex items-center justify-between rounded-el px-3 py-2 mt-2.5 border ${
                  sec.balanceSheet.netDebt <= 0
                    ? "bg-pos-bg border-pos-bdr"
                    : "bg-warn-bg border-warn-bdr"
                }`}
              >
                <span
                  className={`text-[11px] font-medium ${sec.balanceSheet.netDebt <= 0 ? "text-pos" : "text-warn"}`}
                >
                  {sec.balanceSheet.netDebt <= 0 ? "Net cash position" : "Net debt position"}
                </span>
                <span
                  className={`text-sm font-semibold font-mono ${sec.balanceSheet.netDebt <= 0 ? "text-pos" : "text-warn"}`}
                >
                  {usd(Math.abs(sec.balanceSheet.netDebt))}
                </span>
              </div>
            )}
            <p className="text-xs text-ink-2 leading-relaxed mt-2.5">{pick(e.balanceSheet.note, mode)}</p>
          </Panel>
        ) : (
          <Panel title="Balance sheet" tag={<AiSourcedTag />}>
            {(
              [
                ["Cash & equivalents", e.balanceSheet.cash, "bg-pos"],
                ["Total assets", e.balanceSheet.totalAssets, "bg-accent"],
                ["Total liabilities", e.balanceSheet.totalLiabilities, "bg-neg"],
                ["Shareholders' equity", e.balanceSheet.equity, "bg-pos"],
                ["Long-term debt", e.balanceSheet.longTermDebt, "bg-warn"],
              ] as const
            ).map(([label, value, dot], i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-line last:border-b-0">
                <span className="flex items-center gap-2 text-[11px] text-ink-2">
                  <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
                  {label}
                </span>
                <span className="text-xs font-semibold font-mono">{value}</span>
              </div>
            ))}
            <div className="flex items-center justify-between bg-warn-bg border border-warn-bdr rounded-el px-3 py-2 mt-2.5">
              <span className="text-[11px] font-medium text-warn">Net debt position</span>
              <span className="text-sm font-semibold font-mono text-warn">{e.balanceSheet.netDebt}</span>
            </div>
            <p className="text-xs text-ink-2 leading-relaxed mt-2.5">{pick(e.balanceSheet.note, mode)}</p>
          </Panel>
        )}
        {sec?.cashFlow.operatingCF != null ? (
          <Panel title={`Cash flow — ${sec.fiscalPeriod}`} tag={<VerifiedTag />}>
            {(
              [
                ["Operating cash flow", sec.cashFlow.operatingCF],
                ["Capex", sec.cashFlow.capex !== null ? -sec.cashFlow.capex : null],
                ["Free cash flow", sec.cashFlow.freeCashFlow],
                ["Buybacks", sec.cashFlow.buybacks !== null ? -sec.cashFlow.buybacks : null],
                ["Dividends", sec.cashFlow.dividends !== null ? -sec.cashFlow.dividends : null],
              ] as const
            )
              .filter(([, v]) => v !== null)
              .map(([label, value], i) => (
                <div key={i} className="flex items-center justify-between py-2 border-b border-line last:border-b-0">
                  <span className="text-[11px] text-ink-2">{label}</span>
                  <span
                    className={`text-xs font-semibold font-mono ${value! >= 0 ? "text-pos" : "text-neg"}`}
                  >
                    {value! >= 0 ? "+" : "−"}
                    {usd(Math.abs(value!))}
                  </span>
                </div>
              ))}
            <p className="text-[10px] text-ink-3 mt-2.5">
              Source: {sec.form} filed {sec.filedDate} (SEC, via Finnhub)
            </p>
          </Panel>
        ) : (
          <Panel title="Cash flow" tag={<AiSourcedTag />}>
            {e.cashFlow.map((c, i) => (
              <div key={i} className="py-2 border-b border-line last:border-b-0">
                <div className="flex justify-between items-center mb-0.5">
                  <span className="text-[11px] text-ink-2">{c.label}</span>
                  <span
                    className={`text-xs font-semibold font-mono ${
                      c.value.startsWith("-") ? "text-neg" : c.value.startsWith("+") ? "text-pos" : ""
                    }`}
                  >
                    {c.value}
                  </span>
                </div>
                <p className="text-[10px] text-ink-3 leading-relaxed">{pick(c.note, mode)}</p>
              </div>
            ))}
          </Panel>
        )}
      </div>

      <div className="bg-surface border border-line rounded-el p-4 mb-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-[10px] font-semibold tracking-[0.06em] uppercase text-ink-3 flex items-center gap-2">
            {e.guidance.quarter} guidance <AiSourcedTag />
          </h3>
          <span className="text-[11px] text-accent bg-accent-dim px-2.5 py-0.5 rounded-full font-medium">
            Reports {e.guidance.nextReportDate}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-surface-2 rounded-el px-3 py-2.5">
            <p className="text-[10px] text-ink-3 mb-0.5">Revenue range</p>
            <p className="text-[13px] font-semibold font-mono">{e.guidance.revenueRange}</p>
            <p className="text-[10px] text-pos mt-0.5">{e.guidance.vsConsensus}</p>
          </div>
          <div className="bg-surface-2 rounded-el px-3 py-2.5">
            <p className="text-[10px] text-ink-3 mb-0.5">EPS</p>
            <p className="text-[13px] font-semibold font-mono">{e.guidance.eps}</p>
          </div>
          <div className="bg-surface-2 rounded-el px-3 py-2.5">
            <p className="text-[10px] text-ink-3 mb-0.5">Gross margin</p>
            <p className="text-[13px] font-semibold font-mono">{e.guidance.grossMargin}</p>
          </div>
        </div>
        <p className="text-xs text-ink-2 leading-relaxed pt-2.5 border-t border-line">
          {pick(e.guidance.narrative, mode)}
        </p>
      </div>

      <SectionLabel>
        {mode === "explain" ? "What this means" : "Full earnings assessment"}
      </SectionLabel>
      <div className="bg-surface border border-line rounded-el p-4">
        <p className="text-[13px] text-ink-2 leading-[1.75]">{pick(e.summary, mode)}</p>
      </div>
    </div>
  );
}

// ── Ratios ───────────────────────────────────────────────────────

function RatiosTab({
  note,
  mode,
  live,
}: {
  note: ResearchNoteV2;
  mode: Mode;
  live: LiveData | null;
}) {
  const byKey = new Map(note.ratioValues.map((r) => [r.key, r]));
  return (
    <div>
      <SectionLabel>
        Financial ratios — {live ? "live values" : "values"}{" "}
        <span className="normal-case tracking-normal"><VerifiedTag /></span>
        , interpretation by AI
      </SectionLabel>
      {note.ai.ratios.map((r) => {
        const rv = byKey.get(r.key);
        const storedValue = rv?.value ?? null;
        const liveValue = live?.ratios?.[r.key];
        const value = liveValue ?? storedValue;
        // Flag when the live value has moved >10% since the AI wrote its
        // interpretation of the stored value.
        const drifted =
          liveValue != null &&
          storedValue != null &&
          storedValue !== 0 &&
          Math.abs(liveValue - storedValue) / Math.abs(storedValue) > 0.1;
        const tone = TONE[r.verdict];
        return (
          <div key={r.key} className="bg-surface border border-line rounded-card mb-2.5 overflow-hidden">
            <div className="flex items-center justify-between px-4 pt-3.5 pb-3 gap-3 flex-wrap">
              <div>
                <p className="text-[13px] font-medium">{rv?.label ?? r.key}</p>
                <p className="text-[11px] text-ink-3 mt-0.5">{pick(r.peerNote, mode)}</p>
              </div>
              <div className="flex items-center gap-2.5">
                <div className="text-right">
                  <span className={`text-xl font-semibold font-mono ${tone.text}`}>
                    {value != null ? `${value.toFixed(1)}${RATIO_SUFFIX[r.key]}` : "—"}
                  </span>
                  {drifted && (
                    <p className="text-[10px] text-warn leading-tight">
                      was {storedValue!.toFixed(1)}
                      {RATIO_SUFFIX[r.key]} when analysed
                    </p>
                  )}
                </div>
                <span className={`text-[10px] font-semibold px-2 py-1 rounded ${tone.bg} ${tone.text}`}>
                  {r.verdictLabel}
                </span>
              </div>
            </div>
            <div className="px-4 pb-3.5 border-t border-line pt-2.5">
              <div className="flex justify-between text-[10px] text-ink-3 mb-1">
                <span>{r.barLeft}</span>
                <span>{r.barMid}</span>
                <span>{r.barRight}</span>
              </div>
              <div className="h-1 bg-surface-2 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.min(100, Math.max(2, r.barPct))}%`,
                    background: tone.solid,
                  }}
                />
              </div>
              <p className="text-[13px] text-ink-2 leading-[1.7] pt-2.5">{pick(r.explain, mode)}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Deals & Contracts ────────────────────────────────────────────

const STATUS_STYLE = {
  confirmed: { pill: "bg-pos-bg text-pos", border: "border-l-pos", label: "Confirmed" },
  unconfirmed: { pill: "bg-warn-bg text-warn", border: "border-l-warn", label: "Unconfirmed" },
  risk: { pill: "bg-neg-bg text-neg", border: "border-l-neg", label: "Risk" },
} as const;

const CHIP_STYLE = {
  revenue: "bg-pos-bg text-pos",
  strategic: "bg-accent-dim text-accent",
  risk: "bg-neg-bg text-neg",
  neutral: "bg-surface-2 text-ink-2 border border-line",
} as const;

const MGMT_STYLE = {
  positive: "bg-pos-bg text-pos",
  watch: "bg-warn-bg text-warn",
  concern: "bg-neg-bg text-neg",
} as const;

function DealsTab({ note, mode }: { note: ResearchNoteV2; mode: Mode }) {
  const [filter, setFilter] = useState<"all" | "confirmed" | "unconfirmed" | "risk">("all");
  const deals = note.ai.deals.filter((d) => filter === "all" || d.status === filter);

  return (
    <div>
      <SectionLabel>
        Deals & contracts — last 12 months{" "}
        <span className="normal-case tracking-normal"><AiSourcedTag /></span>
      </SectionLabel>
      <div className="flex gap-1.5 flex-wrap mb-4">
        {(["all", "confirmed", "unconfirmed", "risk"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3.5 py-1 rounded-full text-xs font-medium border transition-colors capitalize ${
              filter === f
                ? f === "all"
                  ? "bg-surface-2 text-ink border-line-2"
                  : `${STATUS_STYLE[f].pill} border-transparent`
                : "border-line-2 text-ink-2 bg-surface hover:border-accent"
            }`}
          >
            {f === "all" ? "All" : STATUS_STYLE[f].label}
          </button>
        ))}
      </div>

      {deals.map((d, i) => {
        const st = STATUS_STYLE[d.status];
        return (
          <div
            key={i}
            className={`bg-surface border border-line rounded-card mb-3 overflow-hidden border-l-[3px] ${st.border}`}
          >
            <div className="flex items-start justify-between gap-3 px-4 pt-3.5 pb-3">
              <div className="flex items-start gap-3 min-w-0">
                <span className="w-9 h-9 rounded-el bg-surface-2 border border-line flex items-center justify-center text-[10px] font-semibold font-mono text-ink-2 shrink-0">
                  {d.partnerCode}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-medium leading-snug">{d.title}</p>
                  <p className="text-[11px] text-ink-3 mt-0.5">
                    {pick(d.subtitle, mode)} · {d.date}
                  </p>
                </div>
              </div>
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${st.pill}`}>
                {st.label}
              </span>
            </div>
            <div className="px-4 pb-3.5 pt-3 border-t border-line">
              <p className="text-[13px] text-ink-2 leading-[1.7] mb-2.5">{pick(d.body, mode)}</p>
              <div className="flex gap-1.5 flex-wrap">
                {d.chips.map((c, j) => (
                  <span key={j} className={`text-[11px] px-2.5 py-1 rounded-full ${CHIP_STYLE[c.type]}`}>
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        );
      })}

      <SectionLabel>Management</SectionLabel>
      {note.ai.management.map((m, i) => (
        <div key={i} className="bg-surface border border-line rounded-card p-4 mb-3 flex items-start gap-3.5">
          <span
            className={`w-10 h-10 rounded-full flex items-center justify-center text-[13px] font-semibold shrink-0 ${MGMT_STYLE[m.signal]}`}
          >
            {m.initials}
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-medium">{m.name}</p>
            <p className="text-[11px] text-ink-3 mb-1.5">{m.role}</p>
            <p className="text-[13px] text-ink-2 leading-[1.7]">{pick(m.body, mode)}</p>
            <span
              className={`inline-block text-[10px] font-semibold px-2.5 py-1 rounded-full mt-2 ${MGMT_STYLE[m.signal]}`}
            >
              {m.tagLabel}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Macro ────────────────────────────────────────────────────────

const IMPACT_STYLE = {
  tailwind: "bg-pos-bg text-pos",
  headwind: "bg-neg-bg text-neg",
  mixed: "bg-warn-bg text-warn",
  neutral: "bg-surface-2 text-ink-2",
} as const;

const ARROW = { up: "↑", down: "↓", flat: "→" } as const;
const ARROW_COLOR = { up: "text-pos", down: "text-neg", flat: "text-ink-3" } as const;

function MacroTab({ note, mode }: { note: ResearchNoteV2; mode: Mode }) {
  const m = note.ai.macro;
  return (
    <div>
      <div className="bg-surface border border-line rounded-card p-4 mb-5 flex items-start gap-3.5">
        <span className="w-9 h-9 rounded-el bg-accent-dim text-accent flex items-center justify-center shrink-0" aria-hidden>
          🌐
        </span>
        <p className="text-[13px] text-ink-2 leading-[1.7]">
          <span className="font-medium text-ink">
            {mode === "explain" ? "What does the world around this stock look like? " : "Net macro verdict: "}
          </span>
          {pick(m.summary, mode)}
        </p>
      </div>

      <SectionLabel>
        Macro factors & impact on {note.ticker}{" "}
        <span className="normal-case tracking-normal"><AiSourcedTag /></span>
      </SectionLabel>
      <div className="grid sm:grid-cols-2 gap-2.5 mb-5">
        {m.factors.map((f, i) => (
          <div key={i} className="bg-surface border border-line rounded-card overflow-hidden">
            <div className="flex items-start justify-between gap-2 px-4 pt-3.5 pb-3 border-b border-line">
              <div>
                <p className="text-[13px] font-medium">{f.name}</p>
                <p className="text-[11px] text-ink-3 mt-0.5">{f.reading}</p>
              </div>
              <span className={`text-[10px] font-semibold px-2.5 py-1 rounded-full whitespace-nowrap ${IMPACT_STYLE[f.impact]}`}>
                {f.impactLabel}
              </span>
            </div>
            <div className="px-4 py-3">
              <p className="text-[13px] text-ink-2 leading-[1.7] mb-2">{pick(f.body, mode)}</p>
              <p className={`text-xs font-medium ${ARROW_COLOR[f.arrow]}`}>
                {ARROW[f.arrow]} {f.arrowLabel}
              </p>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-surface border border-line rounded-card p-4">
        <div className="flex items-center justify-between mb-2.5">
          <p className="text-[13px] font-medium">Overall macro backdrop for {note.ticker}</p>
          <p className={`text-[13px] font-medium ${IMPACT_STYLE[m.netImpact.direction].split(" ")[1]}`}>
            {m.netImpact.label}
          </p>
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
        <div className="flex justify-between text-[10px] text-ink-3 mt-1">
          <span>Strong headwind</span>
          <span>Neutral</span>
          <span>Strong tailwind</span>
        </div>
      </div>
    </div>
  );
}

// ── Verdict ──────────────────────────────────────────────────────

const CONV = {
  low: { pct: 25, color: "var(--red)", text: "text-neg" },
  medium: { pct: 52, color: "var(--amber)", text: "text-warn" },
  high: { pct: 82, color: "var(--green)", text: "text-pos" },
} as const;

const REC_CHIP = {
  buy: "bg-pos-bg text-pos border-pos-bdr",
  hold: "bg-warn-bg text-warn border-warn-bdr",
  watch: "bg-accent-dim text-accent border-line",
  caution: "bg-neg-bg text-neg border-neg-bdr",
} as const;

function VerdictTab({ note, mode }: { note: ResearchNoteV2; mode: Mode }) {
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
          <p className="text-sm text-ink-2 leading-[1.8]">{pick(v.text, mode)}</p>
        </div>
        <div className="flex items-center gap-3 pt-3.5 border-t border-line flex-wrap">
          <span className="text-xs text-ink-3 shrink-0">Analysis conviction</span>
          <div className="flex-1 h-[5px] bg-surface-2 rounded-full overflow-hidden min-w-[80px]">
            <div className="h-full rounded-full" style={{ width: `${conv.pct}%`, background: conv.color }} />
          </div>
          <span className={`text-xs font-medium capitalize shrink-0 ${conv.text}`}>{note.ai.conviction}</span>
          <span className="text-[11px] text-ink-3 w-full sm:w-auto">— {note.ai.convictionNote}</span>
        </div>
      </div>

      <SectionLabel>Signal scorecard</SectionLabel>
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

      <SectionLabel>Bull vs bear</SectionLabel>
      <div className="mb-5">
        <BullBear bull={note.ai.overview.bullCase} bear={note.ai.overview.bearCase} />
      </div>

      <SectionLabel>Upcoming catalysts</SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5 mb-5">
        {v.catalysts.map((c, i) => (
          <div key={i} className="flex gap-4 pb-4 last:pb-0">
            <span className="text-[11px] font-mono text-ink-3 w-14 shrink-0 pt-0.5 leading-tight">{c.date}</span>
            <div className="flex flex-col items-center shrink-0 pt-1">
              <span
                className="w-[9px] h-[9px] rounded-full"
                style={{
                  background:
                    c.pill === "bull" ? "var(--green)" : c.pill === "watch" ? "var(--amber)" : "var(--text3)",
                }}
              />
              {i < v.catalysts.length - 1 && <span className="w-px flex-1 min-h-5 mt-1.5 bg-line-2" />}
            </div>
            <div>
              <p className="text-[13px] font-medium mb-1">{c.title}</p>
              <p className="text-xs text-ink-2 leading-relaxed mb-1.5">{pick(c.desc, mode)}</p>
              <span
                className={`inline-block text-[10px] font-semibold px-2.5 py-0.5 rounded-full ${
                  c.pill === "bull"
                    ? "bg-pos-bg text-pos"
                    : c.pill === "watch"
                      ? "bg-warn-bg text-warn"
                      : "bg-surface-2 text-ink-2 border border-line"
                }`}
              >
                {c.pillLabel}
              </span>
            </div>
          </div>
        ))}
      </div>

      <SectionLabel>Research recommendation</SectionLabel>
      <div className="bg-surface border border-line rounded-card p-5">
        <p className="text-[13px] text-ink-2 leading-[1.8] mb-3.5">{pick(v.recommendation.text, mode)}</p>
        <div className="flex gap-2 flex-wrap mb-4">
          {v.recommendation.chips.map((c, i) => (
            <span key={i} className={`text-xs font-medium px-4 py-1.5 rounded-full border ${REC_CHIP[c.tone]}`}>
              {c.label}
            </span>
          ))}
        </div>
        <div className="bg-surface-2 rounded-el px-4 py-3">
          <p className="text-[11px] text-ink-3 leading-relaxed">
            <span className="font-medium text-ink-2">Research note:</span> ClearView generates
            data-driven research positions from public information. This is not personalised
            investment advice and does not account for your financial situation, risk tolerance,
            or objectives. Always consult a qualified adviser before investing.
          </p>
        </div>
      </div>
    </div>
  );
}
