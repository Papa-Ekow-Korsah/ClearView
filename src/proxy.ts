import { NextRequest, NextResponse } from "next/server";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/token";

/**
 * Page-level gating. Logged-out visitors can read /about, /history and
 * /analysis/[ticker]; everything that spends API quota or mutates state
 * requires the owner session. API routes enforce auth themselves — this
 * proxy only handles page redirects.
 */
const PROTECTED_PAGES = ["/watchlist"];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const authed = await verifySessionToken(
    token,
    process.env.SESSION_SECRET ?? ""
  );

  // Root: owner gets the research dashboard; visitors get sent to history,
  // which is the public read-only face of the app.
  if (pathname === "/" && !authed) {
    return NextResponse.redirect(new URL("/history", request.url));
  }

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
