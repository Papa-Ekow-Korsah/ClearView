import { NextRequest, NextResponse } from "next/server";
import { requireOwner } from "@/lib/auth/guard";
import { deleteAnalysis, getAnalysisById } from "@/lib/db/queries";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const denied = await requireOwner();
  if (denied) return denied;

  const { id } = await params;
  const numericId = Number(id);
  if (!Number.isInteger(numericId)) {
    return NextResponse.json({ error: "Invalid analysis id." }, { status: 400 });
  }
  const row = await getAnalysisById(numericId);
  if (!row) {
    return NextResponse.json({ error: "Analysis not found." }, { status: 404 });
  }
  await deleteAnalysis(numericId);
  return NextResponse.json({ ok: true });
}
