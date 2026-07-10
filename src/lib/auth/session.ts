import { cookies } from "next/headers";
import { config } from "@/lib/config";
import {
  SESSION_COOKIE,
  SESSION_DURATION_S,
  signSessionToken,
  verifySessionToken,
} from "@/lib/auth/token";

export async function createSession(): Promise<void> {
  const token = await signSessionToken(config.sessionSecret);
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DURATION_S,
  });
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE);
}

/** True when a valid owner session cookie is present. */
export async function isAuthenticated(): Promise<boolean> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return verifySessionToken(token, config.sessionSecret);
}
