import { expectedMargin, lowestAutoPrice } from "@peaje-asa/policy";
import { ActionForm } from "@/components/action-form";
import { Empty, PageHead } from "@/components/page-head";
import { requireOwner } from "@/lib/auth";
import { usd } from "@/lib/format";
import { policyOf } from "@/lib/shops";
import { addProductAction, archiveProductAction, updateRulesAction } from "./actions";

const input = "mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-base outline-none focus:border-accent sm:text-sm";
const pct = (n: number) => Math.round(n * 1000) / 10;

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

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 border border-border bg-panel p-5">
          <h2 className="font-semibold">Add a product</h2>
          <ActionForm action={addProductAction} label="Put it on sale" pendingLabel="Saving...">
            <label className="block text-sm">Name<input name="name" required maxLength={80} className={input} /></label>
            <label className="block text-sm">Category<input name="category" maxLength={40} placeholder="beans, machines..." className={input} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Price (USD)<input name="listPrice" required inputMode="decimal" className={input} /></label>
              <label className="block text-sm">What it costs you<input name="unitCost" required inputMode="decimal" className={input} /></label>
            </div>
          </ActionForm>
        </div>

        <div className="space-y-3 border border-border bg-panel p-5">
          <h2 className="font-semibold">Rules</h2>
          <ActionForm action={updateRulesAction} label="Save rules" pendingLabel="Saving...">
            <label className="block text-sm">What you sell and where<input name="about" required maxLength={200} defaultValue={shop.about} className={input} /></label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm">Lowest margin (%)<input name="marginFloor" required inputMode="decimal" defaultValue={pct(policy.marginFloor)} className={input} /></label>
              <label className="block text-sm">Discount it gives alone (%)<input name="maxAutoDiscount" required inputMode="decimal" defaultValue={pct(policy.maxAutoDiscount)} className={input} /></label>
              <label className="block text-sm">You approve payments above (USD)<input name="approvalThreshold" required inputMode="decimal" defaultValue={policy.approvalThreshold} className={input} /></label>
              <label className="block text-sm">Cash always kept (USD)<input name="reserveFloor" required inputMode="decimal" defaultValue={policy.reserveFloor} className={input} /></label>
            </div>
          </ActionForm>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-semibold">On sale</h2>
        {onSale.length ? (
          <div className="overflow-x-auto border border-border bg-panel">
            <table className="w-full text-sm">
              <thead className="text-left font-mono text-xs text-muted">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 font-normal">Product</th>
                  <th className="px-4 py-2 font-normal">Category</th>
                  <th className="px-4 py-2 text-right font-normal">Price</th>
                  <th className="px-4 py-2 text-right font-normal">Your cost</th>
                  <th className="px-4 py-2 text-right font-normal">Lowest the agent goes</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {onSale.map((p) => {
                  return (
                    <tr key={p.sku}>
                      <td className="px-4 py-2">{p.name}</td>
                      <td className="px-4 py-2 text-muted">{p.category}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{usd(p.listPrice)}</td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{usd(p.unitCost)} <span className="text-faint">· {pct(expectedMargin(p.listPrice, p.unitCost) / p.listPrice)}%</span></td>
                      <td className="px-4 py-2 text-right font-mono tabular-nums">{usd(lowestAutoPrice(p.listPrice, p.unitCost, policy))}</td>
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
