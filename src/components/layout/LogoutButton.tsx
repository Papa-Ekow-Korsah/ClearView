"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/history");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="text-xs text-ink-3 hover:text-neg transition-colors"
    >
      Sign out
    </button>
  );
}
