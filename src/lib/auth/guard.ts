import { NextResponse } from "next/server";
import { isAuthenticated } from "@/lib/auth/session";

/**
 * API-route auth guard. Returns a 401 response to send back, or null when
 * the caller is the authenticated owner.
 */
export async function requireOwner(): Promise<NextResponse | null> {
  if (await isAuthenticated()) return null;
  return NextResponse.json(
    { error: "Sign in required for this action." },
    { status: 401 }
  );
}
