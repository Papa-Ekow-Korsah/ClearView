import { TickerSearch } from "@/components/analysis/TickerSearch";

export default async function ResearchHome({
  searchParams,
}: {
  searchParams: Promise<{ ticker?: string }>;
}) {
  const { ticker } = await searchParams;
  return (
    <main className="flex-1 flex flex-col items-center justify-center px-6 py-10">
      <p className="text-[11px] font-medium tracking-[0.1em] uppercase text-ink-3 mb-4">
        Deep stock analysis
      </p>
      <h1 className="text-[32px] font-medium tracking-tight text-center leading-tight mb-2.5">
        Search any stock.
        <br />
        Get the full picture.
      </h1>
      <p className="text-[15px] text-ink-2 text-center max-w-[440px] leading-relaxed mb-9">
        Thesis, catalysts, risks, and peer comparables — real fundamentals from
        Finnhub, narrative written by Claude.
      </p>
      <TickerSearch initialTicker={ticker ?? ""} />
    </main>
  );
}
