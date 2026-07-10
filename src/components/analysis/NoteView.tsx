import type { PeerRow, ResearchNote } from "@/types/analysis";

function fmt(v: number | null, opts?: { suffix?: string; digits?: number }): string {
  if (v === null || v === undefined) return "—";
  return `${v.toFixed(opts?.digits ?? 1)}${opts?.suffix ?? ""}`;
}

function fmtMarketCap(millions: number | null): string {
  if (millions === null) return "—";
  if (millions >= 1_000_000) return `$${(millions / 1_000_000).toFixed(2)}T`;
  if (millions >= 1_000) return `$${(millions / 1_000).toFixed(1)}B`;
  return `$${millions.toFixed(0)}M`;
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3 mb-3 pb-2 border-b border-line">
      {children}
    </h2>
  );
}

export function NoteView({ note }: { note: ResearchNote }) {
  const { snapshot, ai } = note;
  const dayPos = (snapshot.dayChangePct ?? 0) >= 0;

  return (
    <div className="max-w-4xl mx-auto w-full px-5 sm:px-7 py-7">
      {/* Header */}
      <header className="mb-7">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <p className="text-xs text-ink-3 mb-1">
              {note.companyName}
              {snapshot.exchange ? ` · ${snapshot.exchange}` : ""}
              {snapshot.industry ? ` · ${snapshot.industry}` : ""}
            </p>
            <h1 className="text-3xl font-semibold font-mono tracking-tight leading-none">
              {note.ticker}
            </h1>
          </div>
          <div className="text-right">
            <p className="text-3xl font-semibold font-mono tracking-tight leading-none">
              {snapshot.price !== null
                ? `$${snapshot.price.toFixed(2)}`
                : "—"}
            </p>
            <p
              className={`text-xs mt-1.5 font-medium ${dayPos ? "text-pos" : "text-neg"}`}
            >
              {snapshot.dayChangePct !== null
                ? `${dayPos ? "+" : ""}${snapshot.dayChangePct.toFixed(2)}% today`
                : ""}
            </p>
          </div>
        </div>
        <div className="flex gap-6 mt-4 text-xs text-ink-3 flex-wrap">
          <span>
            Market cap:{" "}
            <span className="text-ink-2 font-mono">
              {fmtMarketCap(snapshot.marketCap)}
            </span>
          </span>
          <span>
            52-week:{" "}
            <span className="text-ink-2 font-mono">
              {snapshot.week52Low !== null && snapshot.week52High !== null
                ? `$${snapshot.week52Low.toFixed(2)} – $${snapshot.week52High.toFixed(2)}`
                : "—"}
            </span>
          </span>
          <span>
            Generated:{" "}
            <span className="text-ink-2">
              {new Date(note.generatedAt).toLocaleString("en-GB", {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </span>
          </span>
        </div>
      </header>

      {/* Thesis */}
      <section className="mb-7">
        <SectionLabel>Investment thesis</SectionLabel>
        <div className="bg-surface border border-line rounded-card shadow-card p-5 sm:p-6">
          <p className="text-sm text-ink-2 leading-[1.8]">{ai.thesis}</p>
        </div>
      </section>

      {/* Catalysts */}
      <section className="mb-7">
        <SectionLabel>Catalysts</SectionLabel>
        <div className="bg-surface border border-line rounded-card p-5 sm:p-6">
          {ai.catalysts.map((c, i) => (
            <div
              key={i}
              className="flex gap-4 py-3.5 first:pt-0 last:pb-0 border-b border-line last:border-b-0"
            >
              <div className="flex flex-col items-center pt-1.5 shrink-0">
                <div className="w-2 h-2 rounded-full bg-accent" />
                {i < ai.catalysts.length - 1 && (
                  <div className="w-px flex-1 min-h-4 mt-1.5 bg-line-2" />
                )}
              </div>
              <div>
                <div className="flex items-baseline gap-2.5 flex-wrap mb-1">
                  <h3 className="text-[13px] font-medium">{c.title}</h3>
                  <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-accent-dim text-accent">
                    {c.timeframe}
                  </span>
                </div>
                <p className="text-xs text-ink-2 leading-relaxed">
                  {c.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Risks */}
      <section className="mb-7">
        <SectionLabel>Risks</SectionLabel>
        <div className="grid gap-2.5">
          {ai.risks.map((r, i) => (
            <div
              key={i}
              className="bg-surface border border-line border-l-[3px] border-l-neg rounded-card px-4 py-3.5"
            >
              <h3 className="text-[13px] font-medium mb-1">{r.title}</h3>
              <p className="text-xs text-ink-2 leading-relaxed">
                {r.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Peer comparables */}
      <section className="mb-7">
        <SectionLabel>Peer comparables</SectionLabel>
        <div className="bg-surface border border-line rounded-card overflow-hidden mb-3">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-ink-3 border-b border-line">
                  <th className="text-left font-medium px-4 py-2.5">Company</th>
                  <th className="text-right font-medium px-3 py-2.5">
                    Mkt cap
                  </th>
                  <th className="text-right font-medium px-3 py-2.5">
                    Rev growth
                  </th>
                  <th className="text-right font-medium px-3 py-2.5">
                    Gross margin
                  </th>
                  <th className="text-right font-medium px-3 py-2.5">
                    Op margin
                  </th>
                  <th className="text-right font-medium px-3 py-2.5">
                    P/E (TTM)
                  </th>
                  <th className="text-right font-medium px-3 py-2.5">
                    EV/EBITDA
                  </th>
                  <th className="text-right font-medium px-4 py-2.5">
                    Debt/equity
                  </th>
                </tr>
              </thead>
              <tbody>
                {note.peers.map((p) => (
                  <PeerTableRow key={p.ticker} row={p} />
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="bg-surface-2 rounded-el px-4 py-3">
          <p className="text-xs text-ink-2 leading-relaxed">
            <span className="font-medium text-ink">vs peers: </span>
            {ai.peerCommentary}
          </p>
        </div>
      </section>

      {/* Recent headlines */}
      {note.newsHeadlines.length > 0 && (
        <section className="mb-7">
          <SectionLabel>Recent headlines</SectionLabel>
          <div className="bg-surface border border-line rounded-card px-4 py-1">
            {note.newsHeadlines.map((n, i) => (
              <div
                key={i}
                className="flex gap-3 items-baseline py-2.5 border-b border-line last:border-b-0"
              >
                <span className="text-[10px] font-mono text-ink-3 shrink-0 w-[74px]">
                  {n.date}
                </span>
                <p className="text-xs text-ink-2 leading-snug flex-1">
                  {n.headline}
                  <span className="text-ink-3"> — {n.source}</span>
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <p className="text-[11px] text-ink-3 pt-3 border-t border-line leading-relaxed">
        Fundamentals from Finnhub; narrative generated by {note.model}. This is
        a personal research tool, not investment advice. Always do your own
        research.
      </p>
    </div>
  );
}

function PeerTableRow({ row }: { row: PeerRow }) {
  return (
    <tr
      className={`border-b border-line last:border-b-0 ${
        row.isSubject ? "bg-accent-dim/40" : ""
      }`}
    >
      <td className="px-4 py-2.5">
        <span className="font-mono font-semibold">{row.ticker}</span>
        <span className="text-ink-3 ml-2 hidden sm:inline">{row.name}</span>
        {row.isSubject && (
          <span className="ml-2 text-[9px] font-semibold uppercase tracking-wide text-accent">
            subject
          </span>
        )}
      </td>
      <td className="text-right font-mono px-3 py-2.5">
        {fmtMarketCap(row.marketCap)}
      </td>
      <td
        className={`text-right font-mono px-3 py-2.5 ${
          row.revenueGrowthTTM === null
            ? ""
            : row.revenueGrowthTTM >= 0
              ? "text-pos"
              : "text-neg"
        }`}
      >
        {fmt(row.revenueGrowthTTM, { suffix: "%" })}
      </td>
      <td className="text-right font-mono px-3 py-2.5">
        {fmt(row.grossMarginTTM, { suffix: "%" })}
      </td>
      <td className="text-right font-mono px-3 py-2.5">
        {fmt(row.operatingMarginTTM, { suffix: "%" })}
      </td>
      <td className="text-right font-mono px-3 py-2.5">
        {fmt(row.peTTM, { suffix: "x" })}
      </td>
      <td className="text-right font-mono px-3 py-2.5">
        {fmt(row.evEbitdaTTM, { suffix: "x" })}
      </td>
      <td className="text-right font-mono px-4 py-2.5">
        {fmt(row.debtToEquity, { suffix: "x" })}
      </td>
    </tr>
  );
}
