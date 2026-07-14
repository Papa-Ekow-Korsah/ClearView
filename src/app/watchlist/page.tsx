import type { Metadata } from "next";
import { WatchlistView } from "@/components/watchlist/WatchlistView";

export const metadata: Metadata = { title: "Watchlist | ClearView" };

export default function WatchlistPage() {
  return (
    <main className="flex-1">
      <WatchlistView />
    </main>
  );
}
