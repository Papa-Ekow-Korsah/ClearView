import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { config } from "@/lib/config";
import { createSession } from "@/lib/auth/session";

// Simple in-route brute-force damper: bcrypt compare is already slow (~100ms),
// but add a small uniform delay on failure so timing reveals nothing.
export async function POST(request: NextRequest) {
  let body: { password?: string };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON with a password field." },
      { status: 400 }
    );
  }

  const password = body.password ?? "";
  const ok = await bcrypt.compare(password, config.appPasswordHash);

  if (!ok) {
    await new Promise((r) => setTimeout(r, 500));
    return NextResponse.json(
      { error: "Incorrect password." },
      { status: 401 }
    );
  }

  await createSession();
  return NextResponse.json({ ok: true });
}
