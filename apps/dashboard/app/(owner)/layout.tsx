import { advanceOffer } from "@peaje-asa/treasury-agent";
import { MobileTabs, Sidebar } from "@/components/sidebar";
import { requireOwner } from "@/lib/auth";
import { deps, SHOP } from "@/lib/deps";
import { money } from "@/lib/format";

export const dynamic = "force-dynamic";

/** Peaje's console frame: sidebar against the edge with a live number per item, the workspace next to it. */
export default async function OwnerLayout({ children }: { children: React.ReactNode }) {
  await requireOwner();
  const { ledger, conversations, treasury, policy } = deps();
  const waiting = conversations.list().filter((c) => c.status === "escalated" && !c.escalation?.resolution).length;
  const approvals = treasury.approvals("pending").length;
  const openDisputes = ledger.disputes().filter((d) => d.status === "open" || d.status === "challenged" || d.status === "escalated").length;
  const offer = advanceOffer(ledger, policy);
  const items = [
    { href: "/", label: "Overview", valor: money(ledger.cash()), acento: true },
    { href: "/conversations", label: "Conversations", valor: waiting ? `${waiting} for you` : undefined, acento: waiting > 0 },
    { href: "/approvals", label: "Approvals", valor: approvals ? String(approvals) : undefined, acento: approvals > 0 },
    { href: "/disputes", label: "Disputes", valor: openDisputes ? `${openDisputes} open` : undefined },
    { href: "/agents", label: "Agents" },
    { href: "/advance", label: "Advance", valor: offer.amount > 0 ? money(offer.amount) : undefined, acento: offer.amount > 0 },
  ];
  return (
    <div className="mt-6 w-full">
      <div className="flex w-full">
        <Sidebar shop={SHOP} id="tostadero-andino" items={items} chatUrl={process.env.CHAT_URL ?? "http://localhost:3000"} />
        <main className="min-w-0 flex-1 space-y-8 px-4 py-6 sm:p-6 lg:p-10">
          <MobileTabs items={items} />
          {children}
        </main>
      </div>
    </div>
  );
}
