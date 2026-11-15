import Link from "next/link";
import { billStatus, type BillStatus } from "@peaje-asa/treasury-agent";
import { ActionForm } from "@/components/action-form";
import { PageHead } from "@/components/page-head";
import { Badge, EmptyState, HowItWorks, SectionHead, type Tone } from "@/components/plain";
import { requireOwner } from "@/lib/auth";
import { deps } from "@/lib/deps";
import { usd } from "@/lib/format";
import { policyOf } from "@/lib/shops";
import { addBillAction, removeBillAction } from "./actions";

const box = "mt-1.5 flex items-center rounded-lg border border-border bg-bg focus-within:border-accent";
const bare = "w-full min-w-0 bg-transparent px-3 py-2 text-base outline-none sm:text-sm";

function Field({ label, hint, unit, ...input }: { label: string; hint?: string; unit?: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="flex flex-col text-sm">
      <span>{label}</span>
      <span className={`${box} mt-auto`}>
        <input {...input} className={bare} />
        {unit ? <span className="pr-3 font-mono text-xs text-faint">{unit}</span> : null}
      </span>
      {hint ? <span className="mt-1 text-xs text-muted">{hint}</span> : null}
    </label>
  );
}

const STATUS: Record<BillStatus, { label: string; tone: Tone }> = {
  paid: { label: "Paid", tone: "good" },
  paying: { label: "Paying now", tone: "info" },
  waiting_approval: { label: "Waiting for you", tone: "alert" },
  due: { label: "Due, pays at the next close", tone: "info" },
  upcoming: { label: "Upcoming", tone: "muted" },
};

const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

/** What the shop owes its suppliers and when. The treasury agent pays each bill on its due date. */
export default async function SuppliersPage() {
  const { shop } = await requireOwner();
  const policy = policyOf(shop);
  const { treasury } = deps(shop.id);
  const today = new Date().toISOString().slice(0, 10);
  const bills = (shop.bills ?? [])
    .map((b) => ({ ...b, status: billStatus(b, treasury, today) }))
    .sort((a, b) => Number(a.status === "paid") - Number(b.status === "paid") || a.dueDate.localeCompare(b.dueDate));
  const open = bills.filter((b) => b.status !== "paid");
  const owed = open.reduce((s, b) => s + b.amount, 0);
  const suppliers = [...new Set(bills.map((b) => b.supplier))];

  return (
    <div className="space-y-8">
      <PageHead
        eyebrow="Suppliers"
        title="What you owe your suppliers"
        sub={`Add each bill with the day it's due. On that day your treasury agent pays it from your Airwallex account, and asks you first when it's above ${usd(policy.approvalThreshold)}.`}
      />

      <section className="space-y-3">
        <SectionHead title="Bills" sub={open.length ? `${open.length} to pay, ${usd(owed)} in total.` : undefined} />
        {bills.length === 0 ? (
          <EmptyState title="No bills yet">
            <p>Your stock is yours already, so the agent pays nothing on its own. Add what you owe a supplier and when, and it pays it on that day.</p>
          </EmptyState>
        ) : (
          <ul className="space-y-2">
            {bills.map((b) => (
              <li key={b.id} className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{b.supplier}</p>
                  <p className="text-sm text-muted">{b.note ? `${b.note} · ` : ""}due {b.dueDate === today ? "today" : day(b.dueDate)}</p>
                </div>
                <p className="text-lg font-semibold tabular-nums">{usd(b.amount)}</p>
                <div className="flex items-center gap-3">
                  {b.status === "waiting_approval" ? (
                    <Link href="/approvals"><Badge tone="alert">Waiting for you</Badge></Link>
                  ) : (
                    <Badge tone={STATUS[b.status].tone}>{STATUS[b.status].label}</Badge>
                  )}
                  {b.status === "due" || b.status === "upcoming" ? (
                    <ActionForm action={removeBillAction} label="Remove" pendingLabel="Removing..." fields={{ id: b.id }} secondary small />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-4 rounded-lg border border-border bg-panel p-5">
        <div className="space-y-1">
          <h2 className="font-semibold">Add a bill</h2>
          <p className="text-sm text-muted">From an invoice, or a payment you agreed with a supplier.</p>
        </div>
        <ActionForm action={addBillAction} label="Add bill" pendingLabel="Saving...">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Supplier" name="supplier" required maxLength={80} placeholder="Who you pay" list="known-suppliers" />
            <Field label="Amount" name="amount" required inputMode="decimal" unit="USD" placeholder="250" />
            <Field label="Due on" name="dueDate" type="date" required defaultValue={today} />
            <Field label="What it's for" name="note" maxLength={80} placeholder="Invoice 1042, October restock" />
          </div>
          <datalist id="known-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
        </ActionForm>
        <p className="text-xs text-muted">Test mode: the money goes to a test Airwallex account standing in for your suppliers.</p>
      </section>

      <HowItWorks
        steps={[
          { title: "You add the bill", text: "Who, how much and the day it's due. Nothing is paid to a supplier that isn't here." },
          { title: "The agent pays on the due date", text: "At the day's close it pays every bill that's due, before your profit, and always keeps your cash reserve." },
          { title: "Big ones wait for you", text: <>Above {usd(policy.approvalThreshold)} it asks first in <Link href="/approvals" className="underline">Approvals</Link>. You can change that limit in <Link href="/catalog" className="underline">Catalog</Link>.</> },
        ]}
      />
    </div>
  );
}
