import Link from "next/link";
import { currentOwner } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { logOutAction } from "./login/actions";

/** The back office chrome: floating header with the owner's email, footer. */
export default async function ConsoleLayout({ children }: { children: React.ReactNode }) {
  const owner = await currentOwner();
  return (
    <div className="overflow-x-clip">
      <div aria-hidden className="pointer-events-none fixed inset-x-0 top-0 z-30 h-24 bg-gradient-to-b from-bg via-bg/90 to-transparent" />
      <header className="isla-tinta sticky top-4 z-40 mx-auto max-w-5xl px-3 sm:px-6">
        <div className="flex items-center justify-between gap-2 rounded-full border border-border bg-panel px-3 py-2.5 shadow-lg shadow-black/30 sm:px-5">
          <Link href="/" className="flex items-center">
            <Logo />
          </Link>
          {owner ? (
            <nav className="flex items-center gap-3 text-sm">
              <span className="etiqueta hidden text-muted sm:inline">{owner.email}</span>
              <form action={logOutAction}>
                <button type="submit" className="btn btn-secundario btn-chico">Sign out</button>
              </form>
            </nav>
          ) : (
            <nav className="flex items-center gap-2 text-sm">
              <Link href="/login" className="btn btn-secundario btn-chico">Sign in</Link>
              <Link href="/signup" className="btn btn-primario btn-chico">Open a shop</Link>
            </nav>
          )}
        </div>
      </header>
      {children}
      <footer className="border-t border-border px-6 py-8">
        <p className="etiqueta mx-auto max-w-5xl text-center text-muted">Peaje ASA · Airwallex sandbox · Metal testnet · 2026</p>
      </footer>
    </div>
  );
}
