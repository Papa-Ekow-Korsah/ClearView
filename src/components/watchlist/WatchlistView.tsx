"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Sparkline } from "@/components/watchlist/Sparkline";

interface Item {
  ticker: string;
  companyName: string | null;
  spark: number[];
  latestAnalysisId: number | null;
}

interface QuoteEntry {
  price: number | null;
  changePct: number | null;
}

const POLL_MS = 45_000;

export function WatchlistView() {
  const [items, setItems] = useState<Item[] | null>(null);
  const [quotes, setQuotes] = useState<Record<string, QuoteEntry>>({});
  const [error, setError] = useState<string | null>(null);
  const [addTicker, setAddTicker] = useState("");
  const [adding, setAdding] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Failed to load watchlist (HTTP ${res.status}).`);
        return;
      }
      setItems(body.items);
      setError(null);
    } catch {
      setError("Could not reach the server.");
    }
  }, []);

  const pollQuotes = useCallback(async () => {
    if (document.hidden) return; // don't burn quota in background tabs
    try {
      const res = await fetch("/api/watchlist/quotes");
      if (!res.ok) return;
      const body = await res.json();
      const map: Record<string, QuoteEntry> = {};
      for (const q of body.quotes ?? []) {
        map[q.ticker] = { price: q.price, changePct: q.changePct };
      }
      setQuotes(map);
    } catch {
      // transient poll failure — keep last known prices
    }
  }, []);

  useEffect(() => {
    loadList().then(pollQuotes);
    pollRef.current = setInterval(pollQuotes, POLL_MS);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [loadList, pollQuotes]);

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    const t = addTicker.trim().toUpperCase();
    if (!t || adding) return;
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Could not add ${t} (HTTP ${res.status}).`);
      } else {
        setAddTicker("");
        await loadList();
        await pollQuotes();
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setAdding(false);
    }
  }

  async function handleRemove(ticker: string) {
    setItems((prev) => prev?.filter((i) => i.ticker !== ticker) ?? null);
    await fetch(`/api/watchlist?ticker=${ticker}`, { method: "DELETE" });
  }

  return (
    <div className="max-w-2xl mx-auto w-full px-5 sm:px-7 py-7">
      <h1 className="text-xl font-semibold tracking-tight mb-5">Watchlist</h1>

      <form onSubmit={handleAdd} className="flex gap-2 mb-5">
        <input
          value={addTicker}
          onChange={(e) => setAddTicker(e.target.value)}
          placeholder="Add ticker…"
          maxLength={6}
          className="h-9 px-3 rounded-el border border-line-2 bg-surface font-mono text-sm uppercase outline-none focus:border-accent transition-colors w-40 placeholder:normal-case placeholder:font-sans"
        />
        <button
          type="submit"
          disabled={adding || !addTicker.trim()}
          className="h-9 px-4 rounded-el bg-accent text-white text-[13px] font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
        >
          {adding ? "Adding…" : "Add"}
        </button>
      </form>

      {error && (
        <p className="text-xs text-neg bg-neg-bg border border-neg-bdr rounded-el px-3 py-2 mb-4">
          {error}
        </p>
      )}

      {items === null ? (
        <div className="py-14 text-center">
          <div className="w-8 h-8 rounded-full border-[2.5px] border-surface-3 border-t-accent animate-spin mx-auto mb-3" />
          <p className="text-xs text-ink-3">Loading watchlist…</p>
        </div>
      ) : items.length === 0 ? (
        <div className="bg-surface border border-line rounded-card py-12 text-center">
          <p className="text-sm text-ink-2 mb-1">No tickers yet.</p>
          <p className="text-xs text-ink-3">
            Add one above — prices refresh every 45 seconds while the tab is open.
          </p>
        </div>
      ) : (
        <div className="bg-surface border border-line rounded-card overflow-hidden">
          {items.map((item) => {
            const q = quotes[item.ticker];
            const pos = (q?.changePct ?? 0) >= 0;
            return (
              <div
                key={item.ticker}
                className="flex items-center gap-3 px-4 py-3 border-b border-line last:border-b-0 hover:bg-surface-2/60 transition-colors"
              >
                <Link
                  href={
                    item.latestAnalysisId !== null
                      ? `/analysis/${item.latestAnalysisId}`
                      : `/?ticker=${item.ticker}`
                  }
                  className="flex items-center gap-3 flex-1 min-w-0"
                >
                  <div className="min-w-[72px]">
                    <p className="text-[13px] font-mono font-semibold">
                      {item.ticker}
                    </p>
                    <p className="text-[11px] text-ink-3 truncate max-w-[160px]">
                      {item.companyName ?? ""}
                    </p>
                  </div>
                  <Sparkline closes={item.spark} />
                  <div className="ml-auto text-right">
                    <p className="text-[13px] font-mono font-semibold">
                      {q?.price != null ? `$${q.price.toFixed(2)}` : "—"}
                    </p>
                    <p
                      className={`text-[11px] font-medium ${
                        q?.changePct == null
                          ? "text-ink-3"
                          : pos
                            ? "text-pos"
                            : "text-neg"
                      }`}
                    >
                      {q?.changePct != null
                        ? `${pos ? "+" : ""}${q.changePct.toFixed(2)}%`
                        : ""}
                    </p>
                  </div>
                </Link>
                <button
                  onClick={() => handleRemove(item.ticker)}
                  aria-label={`Remove ${item.ticker}`}
                  className="text-ink-3 hover:text-neg text-sm px-1.5 transition-colors"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <p className="text-[11px] text-ink-3 mt-4">
        {items && items.length > 0
          ? "Click a row to open its latest research note. Prices refresh every 45s while this tab is open."
          : ""}
      </p>
    </div>
  );
}
