"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteAnalysisButton({ id }: { id: number }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  async function handleDelete() {
    if (!confirming) {
      setConfirming(true);
      setTimeout(() => setConfirming(false), 3000);
      return;
    }
    setBusy(true);
    const res = await fetch(`/api/history/${id}`, { method: "DELETE" });
    if (res.ok) router.refresh();
    setBusy(false);
    setConfirming(false);
  }

  return (
    <button
      onClick={handleDelete}
      disabled={busy}
      className={`text-[11px] px-2 py-1 rounded transition-colors ${
        confirming
          ? "bg-neg-bg text-neg border border-neg-bdr"
          : "text-ink-3 hover:text-neg"
      }`}
    >
      {busy ? "Deleting…" : confirming ? "Confirm delete" : "Delete"}
    </button>
  );
}
