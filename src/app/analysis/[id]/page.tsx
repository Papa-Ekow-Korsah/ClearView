import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getAnalysisById } from "@/lib/db/queries";
import { NoteView } from "@/components/analysis/NoteView";
import { TabbedNoteView } from "@/components/analysis/v2/TabbedNoteView";
import { EtfNoteView } from "@/components/analysis/etf/EtfNoteView";
import type { ResearchNote } from "@/types/analysis";
import type { ResearchNoteV2 } from "@/types/analysis-v2";
import type { ResearchNoteEtf } from "@/types/analysis-etf";

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

  const note = row.note;
  const version = "formatVersion" in note ? note.formatVersion : 1;

  return (
    <main className="flex-1 flex flex-col">
      {version === 3 ? (
        <EtfNoteView note={note as ResearchNoteEtf} />
      ) : version === 2 ? (
        <TabbedNoteView note={note as ResearchNoteV2} />
      ) : (
        <NoteView note={note as ResearchNote} />
      )}
    </main>
  );
}
