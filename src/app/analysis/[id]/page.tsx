import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAnalysisById } from "@/lib/db/queries";
import { NoteView } from "@/components/analysis/NoteView";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const row = Number.isInteger(Number(id))
    ? await getAnalysisById(Number(id))
    : null;
  return {
    title: row
      ? `${row.ticker} — ${row.companyName} | ClearView`
      : "Analysis | ClearView",
  };
}

export default async function AnalysisPage({ params }: Props) {
  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) notFound();

  const row = await getAnalysisById(numericId);
  if (!row) notFound();

  return (
    <main className="flex-1">
      <NoteView note={row.note} />
    </main>
  );
}
