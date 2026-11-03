"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type Item = { href: string; label: string; valor?: string; acento?: boolean };

/** Peaje's console sidebar: the shop's identity, one item per section with its live number, the chat link at the bottom. */
export function Sidebar({ shop, id, items, chatUrl }: { shop: string; id: string; items: Item[]; chatUrl: string }) {
  const pathname = usePathname();
  const iniciales = shop.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <aside className="scroll-thin sticky top-16 hidden h-[calc(100vh-5rem)] w-64 shrink-0 flex-col justify-between gap-6 self-start overflow-y-auto border-r border-border bg-panel p-4 md:flex">
      <div className="space-y-6">
        <div className="border border-border bg-bg p-3">
          <div className="flex items-center gap-2.5">
            <div className="flex h-6 w-6 shrink-0 items-center justify-center bg-negro font-mono text-[10px] font-bold text-white">{iniciales}</div>
            <div className="overflow-hidden">
              <h2 className="truncate font-mono text-xs leading-none font-bold">{shop}</h2>
              <p className="mt-1 font-mono text-[10px] text-muted">ID: {id}</p>
            </div>
          </div>
        </div>
        <nav className="space-y-1 font-mono text-xs">
          {items.map((item) => {
            const activo = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center justify-between py-2 pr-3 pl-3 transition-colors ${
                  activo ? "border-l-2 border-accent bg-panel-2 font-bold text-text" : "border-l-2 border-transparent text-muted hover:bg-panel-2 hover:text-text"
                }`}
              >
                <span className="flex items-center gap-2.5">
                  {activo ? <span aria-hidden className="h-1.5 w-1.5 bg-accent" /> : null}
                  <span>{item.label}</span>
                </span>
                {item.valor ? <span className={`text-[10px] ${activo || item.acento ? "font-bold text-accent" : "text-muted/70"}`}>{item.valor}</span> : null}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="space-y-3 border-t border-border pt-4">
        <a href={chatUrl} target="_blank" rel="noreferrer" className="btn btn-secundario btn-chico btn-ancho">Open the shop chat</a>
        <p className="px-3 font-mono text-[10px] text-muted">Airwallex sandbox · Metal float simulated until M5</p>
      </div>
    </aside>
  );
}

/** On phones the sidebar doesn't fit: the same sections as a row of tabs. */
export function MobileTabs({ items }: { items: Item[] }) {
  const pathname = usePathname();
  return (
    <nav className="scroll-thin -mx-4 flex gap-2 overflow-x-auto px-4 pb-2 font-mono text-xs md:hidden">
      {items.map((item) => {
        const activo = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} className={`shrink-0 border px-3 py-2 ${activo ? "border-accent bg-panel-2 font-bold" : "border-border text-muted"}`}>
            {item.label}{item.valor ? ` · ${item.valor}` : ""}
          </Link>
        );
      })}
    </nav>
  );
}
