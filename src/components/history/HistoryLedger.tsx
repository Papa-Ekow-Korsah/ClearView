"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { DeleteAnalysisButton } from "@/components/history/DeleteAnalysisButton";
import type { CallOutcome, TrackRecord } from "@/lib/track-record";

export interface LedgerRow {
  id: number;
  ticker: string;
  companyName: string;
  createdAt: string;
  signal: "BUY" | "HOLD" | "SELL" | null;
  verified: boolean;
}

const SIGNAL_CHIP: Record<string, string> = {
  BUY: "bg-pos-bg text-pos border-pos-bdr",
  HOLD: "bg-warn-bg text-warn border-warn-bdr",
  SELL: "bg-neg-bg text-neg border-neg-bdr",
};

function signed(n: number, digits = 1): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(digits)}%`;
}

export function HistoryLedger({
  rows,
  authed,
  filtered,
}: {
  rows: LedgerRow[];
  authed: boolean;
  filtered: boolean;
}) {
  const [record, setRecord] = useState<TrackRecord | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/track-record")
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data: TrackRecord) => {
        if (!cancelled) setRecord(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const byId = new Map<number, CallOutcome>(
    (record?.outcomes ?? []).map((o) => [o.id, o])
  );

  return (
    <>
      {!filtered && <TrackRecordCard record={record} failed={failed} />}

      <div className="bg-surface border border-line rounded-card overflow-hidden">
        {rows.map((row) => {
          const outcome = byId.get(row.id);
          const alpha = outcome?.unrealized?.alphaPct ?? null;
          const matured = outcome?.scored.at(-1) ?? null;
          return (
            <div
              key={row.id}
              className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0 hover:bg-surface-2/60 transition-colors"
            >
              <Link
                href={`/analysis/${row.id}`}
                className="flex items-center gap-3 flex-1 min-w-0"
              >
                <span className="text-[13px] font-mono font-semibold w-14 shrink-0">
                  {row.ticker}
                </span>
                {row.signal && (
                  <span
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded border shrink-0 ${SIGNAL_CHIP[row.signal]}`}
                  >
                    {row.signal}
                  </span>
                )}
                <span className="text-[13px] text-ink-2 truncate hidden sm:block">
                  {row.companyName}
                </span>
                {row.verified && (
                  <span
                    title="Backed by verified SEC filing data"
                    className="text-[9px] font-semibold uppercase tracking-wide text-teal bg-teal-bg rounded px-1.5 py-0.5 shrink-0 hidden md:inline"
                  >
                    ✓ SEC
                  </span>
                )}

                <span className="ml-auto flex items-center gap-3 shrink-0">
                  {alpha !== null && row.signal !== "HOLD" ? (
                    <span className="text-right">
                      <span
                        className={`text-[13px] font-mono font-semibold block leading-tight ${
                          alpha >= 0 ? "text-pos" : "text-neg"
                        }`}
                      >
                        {signed(alpha)}
                      </span>
                      <span className="text-[10px] text-ink-3 leading-tight">
                        vs S&amp;P{matured ? "" : " · unrealized"}
                      </span>
                    </span>
                  ) : alpha !== null ? (
                    <span className="text-[10px] text-ink-3">not scored</span>
                  ) : null}
                  <span className="text-[11px] text-ink-3 font-mono w-[74px] text-right">
                    {new Date(row.createdAt).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                </span>
              </Link>
              {authed && <DeleteAnalysisButton id={row.id} />}
            </div>
          );
        })}
      </div>
    </>
  );
}

function TrackRecordCard({
  record,
  failed,
}: {
  record: TrackRecord | null;
  failed: boolean;
}) {
  if (failed) return null;

  if (!record) {
    return (
      <div className="bg-surface border border-line rounded-card p-4 mb-5 animate-pulse">
        <div className="h-3 w-28 bg-surface-2 rounded mb-3" />
        <div className="h-2.5 w-full max-w-md bg-surface-2 rounded" />
      </div>
    );
  }

  if (record.totalCalls === 0) return null;

  const scoredHorizons = record.horizons.filter((h) => h.scoredCalls > 0);
  const hasScores = scoredHorizons.length > 0;

  return (
    <div className="bg-surface border border-line rounded-card p-4 sm:p-5 mb-5">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1">
        <h2 className="text-[10px] font-semibold tracking-[0.1em] uppercase text-ink-3">
          Track record
        </h2>
        <p className="text-[11px] text-ink-3">
          {record.directionalCalls} directional call
          {record.directionalCalls === 1 ? "" : "s"} ·{" "}
          {record.distinctTickers} ticker
          {record.distinctTickers === 1 ? "" : "s"}
          {record.holdCalls > 0 ? ` · ${record.holdCalls} HOLD not scored` : ""}
        </p>
      </div>
      <p className="text-[13px] text-ink-2 leading-relaxed mb-4">
        Every signal this tool has produced, scored against the S&amp;P 500 over
        fixed horizons set in advance. A BUY that falls less than the market
        still counts as a good call; HOLDs aren&apos;t directional so they
        aren&apos;t scored. Deleted notes stay in the record.
      </p>

      {hasScores ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-3">
          {record.horizons.map((h) => (
            <div
              key={h.horizon}
              className={`rounded-el px-3 py-2.5 border ${
                h.scoredCalls > 0
                  ? "bg-surface-2 border-line"
                  : "bg-surface border-line opacity-60"
              }`}
            >
              <p className="text-[10px] text-ink-3 mb-1">{h.horizon}-day</p>
              {h.scoredCalls > 0 ? (
                <>
                  <p className="text-lg font-semibold font-mono leading-none">
                    {h.hitRatePct!.toFixed(0)}%
                  </p>
                  <p className="text-[10px] text-ink-3 mt-1">
                    {h.correctCalls}/{h.scoredCalls} beat benchmark
                  </p>
                  <p
                    className={`text-[10px] mt-0.5 font-medium ${
                      (h.avgAlphaPct ?? 0) >= 0 ? "text-pos" : "text-neg"
                    }`}
                  >
                    {signed(h.avgAlphaPct!)} avg alpha
                  </p>
                </>
              ) : (
                <p className="text-[11px] text-ink-3 mt-1">not yet matured</p>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-surface-2 rounded-el px-4 py-3 mb-3">
          <p className="text-[13px] text-ink-2 leading-relaxed">
            <span className="font-medium text-ink">
              No calls have matured yet.
            </span>{" "}
            The first scored results appear once calls reach 30 days old
            {record.pendingCalls > 0
              ? ` — ${record.pendingCalls} call${record.pendingCalls === 1 ? "" : "s"} currently maturing`
              : ""}
            . Unrealized performance versus the S&amp;P is shown per call below,
            but it isn&apos;t a result until the horizon closes.
          </p>
        </div>
      )}

      {hasScores && (
        <div className="mb-3">
          <p className="text-[10px] font-semibold tracking-[0.06em] uppercase text-ink-3 mb-2">
            Conviction calibration
          </p>
          <div className="flex gap-2 flex-wrap">
            {scoredHorizons[0].byConviction.map((c) => (
              <span
                key={c.conviction}
                className="text-[11px] text-ink-2 bg-surface-2 rounded-full px-3 py-1 capitalize"
              >
                {c.conviction}:{" "}
                {c.scoredCalls > 0 ? (
                  <span className="font-mono font-medium">
                    {c.hitRatePct!.toFixed(0)}% ({c.scoredCalls})
                  </span>
                ) : (
                  <span className="text-ink-3">no data</span>
                )}
              </span>
            ))}
          </div>
          <p className="text-[11px] text-ink-3 mt-2 leading-relaxed">
            High-conviction calls should beat low-conviction ones. If they
            don&apos;t, the conviction rating is noise.
          </p>
        </div>
      )}

      <p className="text-[11px] text-ink-3 leading-relaxed pt-3 border-t border-line">
        <span className="font-medium text-ink-2">Read this sceptically.</span>{" "}
        Distinguishing skill from luck in equity calls takes far more
        observations than this — with {record.totalCalls} call
        {record.totalCalls === 1 ? "" : "s"} across {record.distinctTickers}{" "}
        ticker{record.distinctTickers === 1 ? "" : "s"}, repeat calls on the
        same company are correlated rather than independent evidence. Treat this
        as an accountability log, not proof of edge.
      </p>
    </div>
  );
}
