import Link from "next/link";
import { isAuthenticated } from "@/lib/auth/session";
import { LogoutButton } from "@/components/layout/LogoutButton";

export async function AppNav() {
  const authed = await isAuthenticated();

  return (
    <nav className="h-[58px] flex items-center justify-between px-5 sm:px-7 bg-surface border-b border-line shrink-0">
      <div className="flex items-center gap-6">
        <Link
          href={authed ? "/" : "/history"}
          className="text-[17px] font-semibold tracking-tight"
        >
          Clear<span className="text-accent">View</span>
        </Link>
        <div className="flex items-center gap-1 text-[13px]">
          {authed && (
            <>
              <NavLink href="/">Research</NavLink>
              <NavLink href="/watchlist">Watchlist</NavLink>
            </>
          )}
          <NavLink href="/history">History</NavLink>
          <NavLink href="/about">About</NavLink>
        </div>
      </div>
      <div className="flex items-center gap-4">
        {authed ? (
          <LogoutButton />
        ) : (
          <Link
            href="/login"
            className="text-xs text-ink-3 hover:text-accent transition-colors"
          >
            Owner sign-in
          </Link>
        )}
      </div>
    </nav>
  );
}

function NavLink({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="px-2.5 py-1.5 rounded-el text-ink-2 hover:text-ink hover:bg-surface-2 transition-colors font-medium"
    >
      {children}
    </Link>
  );
}
