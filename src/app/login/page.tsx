"use client";

import { FormEvent, Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.push(searchParams.get("from") ?? "/");
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => null);
      setError(body?.error ?? `Login failed (HTTP ${res.status}).`);
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-2xl font-semibold tracking-tight mb-2">
            Clear<span className="text-accent">View</span>
          </div>
          <p className="text-sm text-ink-2">
            Owner sign-in. Visitors can browse{" "}
            <Link href="/history" className="text-accent hover:underline">
              published research
            </Link>{" "}
            or read{" "}
            <Link href="/about" className="text-accent hover:underline">
              about the project
            </Link>
            .
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="bg-surface border border-line rounded-card shadow-card p-6 flex flex-col gap-4"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-ink-2">Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              autoComplete="current-password"
              className="h-10 px-3 rounded-el border border-line-2 bg-surface font-mono text-sm outline-none focus:border-accent transition-colors"
            />
          </label>

          {error && (
            <p className="text-xs text-neg bg-neg-bg border border-neg-bdr rounded-el px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={submitting || !password}
            className="h-10 rounded-el bg-accent text-white text-sm font-medium disabled:opacity-50 hover:opacity-90 transition-opacity"
          >
            {submitting ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
