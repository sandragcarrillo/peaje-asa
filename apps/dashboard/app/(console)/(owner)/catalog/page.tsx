import { expectedMargin, lowestAutoPrice } from "@peaje-asa/policy";
import { ActionForm } from "@/components/action-form";
import { Empty, PageHead } from "@/components/page-head";
import { PricePreview } from "@/components/price-preview";
import { requireOwner } from "@/lib/auth";
import { usd } from "@/lib/format";
import { policyOf } from "@/lib/shops";
import { addProductAction, archiveProductAction, updateRulesAction } from "./actions";

const box = "mt-1.5 flex items-center rounded-lg border border-border bg-bg focus-within:border-accent";
const bare = "w-full min-w-0 bg-transparent px-3 py-2 text-base outline-none sm:text-sm";
const pct = (n: number) => Math.round(n * 1000) / 10;

/** A labelled input with its unit inside the box and a one-line hint under it. The input sits at the bottom so a row of fields lines up whatever the label length. */
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

function Panel({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <div className="space-y-4 border border-border bg-panel p-5">
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-muted">{sub}</p>
      </div>
      {children}
    </div>
  );
}

export default async function Catalog() {
  const { shop } = await requireOwner();
  const policy = policyOf(shop);
  const onSale = policy.catalog.filter((p) => !p.archived);
  return (
    <section className="space-y-8">
      <PageHead
        eyebrow={`${shop.name} · USD`}
        title="Catalog and rules"
        sub="What the agent may sell and how far it may go. Prices, costs and limits live here, in code the agent can't talk its way around, never in its prompt."
      />

      <div className="border border-border bg-panel">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-5 py-4">
          <div className="space-y-1">
            <h2 className="font-semibold">Rules</h2>
            <p className="text-sm text-muted">{shop.about.charAt(0).toUpperCase() + shop.about.slice(1)}. They apply to every product and every conversation.</p>
          </div>
        </div>
        <dl className="grid grid-cols-2 divide-border lg:grid-cols-4 lg:divide-x">
          {[
            [`${pct(policy.marginFloor)}%`, "Lowest margin", "Never sells below it"],
            [`${pct(policy.maxAutoDiscount)}%`, "Discount on its own", "More than this goes to you"],
            [usd(policy.approvalThreshold), "You approve payments above", "Anything bigger waits for you"],
            [usd(policy.reserveFloor), "Cash always kept", "Payments never take you below it"],
          ].map(([value, label, hint]) => (
            <div key={label} className="space-y-1 px-5 py-4">
              <dd className="font-mono text-xl whitespace-nowrap tabular-nums sm:text-2xl">{value}</dd>
              <dt className="text-sm">{label}</dt>
              <p className="text-xs text-muted">{hint}</p>
            </div>
          ))}
        </dl>
        <details className="group border-t border-border">
          <summary className="cursor-pointer list-none px-5 py-3 font-mono text-xs text-muted hover:text-text">
            <span className="group-open:hidden">Edit rules</span><span className="hidden group-open:inline">Close</span>
          </summary>
          <div className="px-5 pb-5">
            <ActionForm action={updateRulesAction} label="Save rules" pendingLabel="Saving...">
              <label className="block text-sm">
                What you sell and where
                <textarea name="about" required maxLength={200} rows={2} defaultValue={shop.about} className={`${box} ${bare} resize-none`} />
                <span className="mt-1 block text-xs text-muted">The agent introduces the shop with this.</span>
              </label>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Field label="Lowest margin" unit="%" name="marginFloor" required inputMode="decimal" defaultValue={pct(policy.marginFloor)} />
                <Field label="Discount on its own" unit="%" name="maxAutoDiscount" required inputMode="decimal" defaultValue={pct(policy.maxAutoDiscount)} />
                <Field label="You approve above" unit="USD" name="approvalThreshold" required inputMode="decimal" defaultValue={policy.approvalThreshold} />
                <Field label="Cash always kept" unit="USD" name="reserveFloor" required inputMode="decimal" defaultValue={policy.reserveFloor} />
              </div>
            </ActionForm>
          </div>
        </details>
      </div>

      <Panel title="Add a product" sub="The agent can quote it from the next message.">
        <ActionForm action={addProductAction} label="Put it on sale" pendingLabel="Saving...">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
            <Field label="Name" name="name" required maxLength={80} placeholder="Huila washed, 250 g" />
            <Field label="Category" name="category" maxLength={40} placeholder="beans, machines..." />
            <PricePreview rules={{ marginFloor: policy.marginFloor, maxAutoDiscount: policy.maxAutoDiscount }} />
          </div>
        </ActionForm>
      </Panel>

      <div className="space-y-3">
        <h2 className="flex items-baseline gap-2 font-semibold">On sale <span className="font-mono text-xs font-normal text-muted">{onSale.length}</span></h2>
        {onSale.length ? (
          <div className="overflow-x-auto border border-border bg-panel">
            <table className="w-full text-sm">
              <thead className="text-left font-mono text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-normal">Product</th>
                  <th className="px-4 py-2 font-normal">Category</th>
                  <th className="px-4 py-2 text-right font-normal whitespace-nowrap">Price</th>
                  <th className="px-4 py-2 text-right font-normal whitespace-nowrap">Your cost · margin</th>
                  <th className="px-4 py-2 text-right font-normal whitespace-nowrap">Agent's floor</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {onSale.map((p) => {
                  const margin = expectedMargin(p.listPrice, p.unitCost) / p.listPrice;
                  // Within 5 points of the floor: the agent has almost no room to discount.
                  const tight = margin - policy.marginFloor < 0.05;
                  return (
                    <tr key={p.sku} className="hover:bg-bg/40">
                      <td className="px-4 py-2">{p.name}</td>
                      <td className="px-4 py-2 text-muted">{p.category}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums whitespace-nowrap">{usd(p.listPrice)}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums whitespace-nowrap">
                        {usd(p.unitCost)} <span className={tight ? "text-amber-400" : "text-faint"} title={tight ? "Close to your lowest margin: little room to discount" : undefined}>· {pct(margin)}%</span>
                      </td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums whitespace-nowrap">{usd(lowestAutoPrice(p.listPrice, p.unitCost, policy))}</td>
                      <td className="px-4 py-2 text-right">
                        <ActionForm action={archiveProductAction} label="Take off sale" pendingLabel="..." fields={{ sku: p.sku }} secondary small />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <Empty>Nothing on sale yet. Add your first product above; the agent can quote it from the next message.</Empty>
        )}
      </div>
    </section>
  );
}
