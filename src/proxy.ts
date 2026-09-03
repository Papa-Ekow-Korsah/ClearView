import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/token";

/**
 * Page-level gating. Research is open to everyone: anyone can land on the
 * search page, run an analysis and read the archive. The owner session is
 * still required for the personal watchlist and for deleting notes, since
 * neither is part of looking up a stock. API routes enforce auth
 * themselves — this proxy only handles page redirects.
 */
const PROTECTED_PAGES = ["/watchlist"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(
    token,
    process.env.SESSION_SECRET ?? ""
  );

  if (PROTECTED_PAGES.some((p) => pathname.startsWith(p)) && !authed) {
    const login = new URL("/login", request.url);
    login.searchParams.set("from", pathname);
    return NextResponse.redirect(login);
  }

  // Already logged in? /login is pointless — go home.
  if (pathname === "/login" && authed) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/watchlist/:path*"],
};
