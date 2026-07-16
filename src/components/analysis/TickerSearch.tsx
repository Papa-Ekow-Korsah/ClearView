"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

const QUICK_TICKERS = ["AAPL", "MSFT", "NVDA", "TSLA", "INTC"];

const STEPS = [
  "Pulling fundamentals from Finnhub…",
  "Selecting peer comparables…",
  "Fetching recent news and earnings history…",
  "Writing the six-section research note…",
  "Writing both voices (Explain + Analyst)…",
  "Assembling verdict and scorecard…",
];

export function TickerSearch({
  initialTicker = "",
}: {
  initialTicker?: string;
}) {
  const router = useRouter();
  const [ticker, setTicker] = useState(initialTicker);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const stepTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (stepTimer.current) clearInterval(stepTimer.current);
    };
  }, []);

  async function analyze(raw: string) {
    const t = raw.trim().toUpperCase();
    if (!t || loading) return;
    setLoading(true);
    setError(null);
    setStep(0);
    stepTimer.current = setInterval(
      () => setStep((s) => (s + 1) % STEPS.length),
      3500
    );

    try {
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker: t }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        setError(body?.error ?? `Analysis failed (HTTP ${res.status}).`);
        return;
      }
      router.push(`/analysis/${body.id}`);
      return; // keep spinner until navigation
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      if (stepTimer.current) clearInterval(stepTimer.current);
    }
    setLoading(false);
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    analyze(ticker);
  }

  if (loading && !error) {
    return (
      <div className="text-center py-16">
        <div className="w-9 h-9 rounded-full border-[2.5px] border-surface-3 border-t-accent animate-spin mx-auto mb-4" />
        <p className="text-sm text-ink-2 mb-1.5">{STEPS[step]}</p>
        <p className="text-xs text-ink-3">
          Running deep analysis on {ticker.toUpperCase()} — usually 1–3 minutes
        </p>
      </div>
    );
  }

  return (
    <>
      <form onSubmit={handleSubmit} className="w-full max-w-[500px] mb-5">
        <div className="flex items-center gap-3 bg-surface border-[1.5px] border-line-2 rounded-card px-4 py-3.5 shadow-card focus-within:border-accent transition-colors">
          <svg
            className="w-4 h-4 text-ink-3 shrink-0"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="m21 21-4.35-4.35M17 10.5a6.5 6.5 0 1 1-13 0 6.5 6.5 0 0 1 13 0Z"
            />
          </svg>
          <input
            value={ticker}
            onChange={(e) => setTicker(e.target.value)}
            placeholder="Enter a ticker — AAPL, MSFT, NVDA…"
            maxLength={10}
            autoFocus
            className="flex-1 bg-transparent outline-none text-[15px] font-mono uppercase tracking-wider placeholder:normal-case placeholder:font-sans placeholder:tracking-normal placeholder:text-sm placeholder:text-ink-3"
          />
          <button
            type="submit"
            disabled={!ticker.trim()}
            className="bg-accent text-white rounded-el px-5 py-2 text-[13px] font-medium disabled:opacity-50 hover:opacity-90 transition-opacity whitespace-nowrap"
          >
            Analyse
          </button>
        </div>
      </form>

      {error && (
        <p className="max-w-[500px] w-full text-xs text-neg bg-neg-bg border border-neg-bdr rounded-el px-3 py-2 mb-5">
          {error}
        </p>
      )}

      <div className="flex items-center gap-2 flex-wrap justify-center">
        <span className="text-xs text-ink-3">Try:</span>
        {QUICK_TICKERS.map((t) => (
          <button
            key={t}
            onClick={() => {
              setTicker(t);
              analyze(t);
            }}
            className="px-3.5 py-1 rounded-full text-xs font-mono font-medium border border-line-2 text-ink-2 bg-surface hover:border-accent hover:text-accent transition-colors"
          >
            {t}
          </button>
        ))}
      </div>
    </>
  );
}
