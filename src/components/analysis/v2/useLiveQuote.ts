"use client";

import { useEffect, useState } from "react";
import type { RatioKey } from "@/types/analysis-v2";

export interface LiveData {
  price: number | null;
  changePct: number | null;
  updatedAt: string;
  ratios: Partial<Record<RatioKey, number | null>>;
}

const POLL_MS = 45_000;

/**
 * Live market-data overlay for a saved note. Polls the (AI-cost-free)
 * live endpoint while the tab is visible; returns null until the first
 * successful fetch, so callers fall back to the note's snapshot values.
 */
export function useLiveQuote(ticker: string): LiveData | null {
  const [live, setLive] = useState<LiveData | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function fetchLive() {
      try {
        const res = await fetch(`/api/live/${ticker}`);
        if (!res.ok) return;
        const data = (await res.json()) as LiveData;
        if (!cancelled) setLive(data);
      } catch {
        // transient failure — keep last known values
      }
    }

    // Fetch immediately; skip only *recurring* polls while hidden, and
    // refresh the moment the tab becomes visible again.
    fetchLive();
    const id = setInterval(() => {
      if (!document.hidden) fetchLive();
    }, POLL_MS);
    const onVisible = () => {
      if (!document.hidden) fetchLive();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ticker]);

  return live;
}
