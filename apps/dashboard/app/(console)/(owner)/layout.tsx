import { advanceOffer, billStatus } from "@peaje-asa/treasury-agent";
import { DemoBanner } from "@/components/demo-banner";
import { DemoChat } from "@/components/demo-chat";
import { demoRun } from "@/lib/demo-history";
import { MobileTabs, Sidebar } from "@/components/sidebar";
import { requireOwner } from "@/lib/auth";
import { deps } from "@/lib/deps";
import { money } from "@/lib/format";
import { setupOf } from "@/lib/shops";

export const dynamic = "force-dynamic";

/** Peaje's console frame: sidebar against the edge with a live number per item, the workspace next to it. */
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  const { shop } = await requireOwner();
  const { ledger, conversations, treasury, policy } = deps(shop.id);
  const waiting = conversations.list().filter((c) => c.status === "escalated" && !c.escalation?.resolution).length;
  const approvals = treasury.approvals("pending").length;
  const openDisputes = ledger.disputes().filter((d) => d.status === "open" || d.status === "challenged" || d.status === "escalated").length;
  const offer = advanceOffer(ledger, policy);
  const billsDue = (shop.bills ?? []).filter((b) => billStatus(b, treasury) === "due").length;
  const items = [
    { href: "/", label: "Overview", valor: money(ledger.cash()), acento: true },
    { href: "/conversations", label: "Conversations", valor: waiting ? `${waiting} for you` : undefined, acento: waiting > 0 },
    { href: "/approvals", label: "Approvals", valor: approvals ? String(approvals) : undefined, acento: approvals > 0 },
    { href: "/suppliers", label: "Suppliers", valor: billsDue ? `${billsDue} due` : undefined },
    { href: "/disputes", label: "Disputes", valor: openDisputes ? `${openDisputes} open` : undefined },
    { href: "/catalog", label: "Catalog", valor: policy.catalog.some((p) => !p.archived) ? undefined : "empty", acento: !policy.catalog.some((p) => !p.archived) },
    { href: "/website", label: "Plugin", valor: shop.embedOrigins?.length ? undefined : "off" },
    { href: "/agents", label: "Agents" },
    { href: "/advance", label: "Advance", valor: offer.amount > 0 ? money(offer.amount) : undefined, acento: offer.amount > 0 },
  ];
  return (
    <div className="mt-6 w-full">
      <div className="flex w-full">
        <Sidebar shop={shop.name} id={shop.id} items={items} chatUrl={`/s/${shop.id}`} />
        <main className="min-w-0 flex-1 space-y-8 px-4 py-6 sm:p-6 lg:p-10">
          <MobileTabs items={items} />
          {shop.demo ? (
            <DemoBanner
              run={demoRun(shop.id)}
              ready={setupOf(shop).canSell}
              sold={ledger.orders().filter((o) => o.paymentIntentId.startsWith("metal:")).length}
              talked={conversations.list().length}
              approvals={approvals}
              disputes={ledger.disputes().length}
              cardSales={ledger.orders().filter((o) => !o.paymentIntentId.startsWith("metal:")).length}
              closedBooks={treasury.settlements().length > 0}
              fresh={Date.now() - Date.parse(shop.createdAt) < 15 * 60_000}
            />
          ) : null}
          {children}
        </main>
        {shop.demo ? <DemoChat shopId={shop.id} ready={setupOf(shop).canSell} /> : null}
      </div>
    </div>
  );
}
