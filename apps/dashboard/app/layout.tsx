import type { Metadata } from "next";
import { Hanken_Grotesk, Space_Mono } from "next/font/google";
import Link from "next/link";
import { currentOwner } from "@/lib/auth";
import { Logo } from "@/components/logo";
import { logOutAction } from "./login/actions";
import "./globals.css";

const sans = Hanken_Grotesk({ variable: "--font-grotesca", subsets: ["latin"] });
const mono = Space_Mono({ variable: "--font-chrome", weight: ["400", "700"], subsets: ["latin"] });

export const metadata: Metadata = { title: "Peaje ASA owner dashboard", description: "What the seller and treasury agents sold, kept and paid." };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const owner = await currentOwner();
  return (
    <html lang="en" className="dark">
      <body className={`${sans.variable} ${mono.variable} antialiased`}>
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
                <span className="etiqueta px-1 text-muted">Owner dashboard</span>
              )}
            </div>
          </header>
          {children}
          <footer className="border-t border-border px-6 py-8">
            <p className="etiqueta mx-auto max-w-5xl text-center text-muted">Peaje ASA · Airwallex sandbox · 2026</p>
          </footer>
        </div>
      </body>
    </html>
  );
}
