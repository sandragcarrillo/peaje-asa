import Link from "next/link";
import { pendingApproval } from "@peaje-asa/metal";
import { openAirwallexAccountAction } from "@/app/(console)/(owner)/actions";
import { ActionForm } from "@/components/action-form";
import { MetalSetup } from "@/components/metal-owner";
import type { Shop } from "@peaje-asa/ledger";
import { metalDirFor, setupOf } from "@/lib/shops";
import type { Approval } from "@/app/(console)/(owner)/agents/actions";

function Step({ n, title, done, children }: { n: number; title: string; done: boolean; children: React.ReactNode }) {
  return (
    <li className={`grid grid-cols-[2rem_1fr] gap-4 border-b border-border px-5 py-5 last:border-b-0 ${done ? "opacity-70" : ""}`}>
      <span aria-hidden className={`grid h-8 w-8 place-items-center border font-mono text-sm ${done ? "border-accent bg-accent text-bg" : "border-border text-muted"}`}>{done ? "✓" : n}</span>
      <div className="min-w-0 space-y-2">
        <h3 className="font-semibold">{title}{done ? <span className="ml-2 font-mono text-xs font-normal text-accent">done</span> : null}</h3>
        {children}
      </div>
    </li>
  );
}

/**
 * The first thing a new owner sees: four steps in order, each with its action right there.
 * Products, the agent's wallet and the Airwallex account where the money lands come first; trying
 * the chat as a buyer is the last step.
 */
export async function SetupSteps({ shop }: { shop: Shop }) {
  const s = setupOf(shop);
  const p = s.wallet ? undefined : await pendingApproval(metalDirFor(shop.id));
  const pending: Approval | undefined = p?.kind === "setup" ? { kind: p.kind, account: p.account, chainId: p.chainId, executionData: p.executionData, nonce: p.nonce, validUntil: p.validUntil, digest: p.digest, summary: p.summary } : undefined;
  const left = [s.products > 0, s.wallet, s.account].filter((d) => !d).length;
  return (
    <div className="border border-accent bg-panel">
      <div className="space-y-1 border-b border-border px-5 py-4">
        <h2 className="text-lg font-semibold">Get your shop ready</h2>
        <p className="text-sm text-muted">{left === 0 ? "All set." : `${left} ${left === 1 ? "step" : "steps"} left. Then try your shop's chat as a buyer.`}</p>
      </div>
      <ol>
        <Step n={1} title="Put products on sale" done={s.products > 0}>
          <p className="text-sm text-muted">
            {s.products > 0
              ? `${s.products} products on sale. Add more or change prices and limits any time in Catalog.`
              : "Add what you sell with its price and what it costs you. The agent never sells below the margin you set."}
          </p>
          <Link href="/catalog" className={`btn btn-chico ${s.products > 0 ? "btn-secundario" : "btn-primario"}`}>{s.products > 0 ? "Open Catalog" : "Add products"}</Link>
        </Step>

        <Step n={2} title="Give your agent a wallet" done={s.wallet}>
          <p className="text-sm text-muted">
            Your agent pays for its own AI replies (a few cents each) from a wallet on Alta&apos;s test network. You set how much it can spend, and nothing moves without your approval.
          </p>
          {s.wallet ? null : <MetalSetup shopId={shop.id} metalOwner={shop.metalOwner} pending={pending} auto={shop.demo} />}
        </Step>

        <Step n={3} title="Open your Airwallex account" done={s.account}>
          <p className="text-sm text-muted">
            {s.account
              ? `Account ${shop.airwallexAccountId}. Sales move there at each close; supplier bills and your profit are paid out of it.`
              : "Where your sales land, and where supplier bills and your profit are paid from. In the sandbox Airwallex's review is simulated with sample company details."}
          </p>
          {s.account ? null : <div className="max-w-xs"><ActionForm action={openAirwallexAccountAction} label="Open my Airwallex account" pendingLabel="Opening (about 30 s)..." small /></div>}
        </Step>
        <Step n={4} title="Try your shop's chat" done={false}>
          <p className="text-sm text-muted">
            {s.done ? "Open the chat your buyers see and ask for something. Your agent answers, quotes within your rules and sends a payment link. Pay it with the test card 4035 5010 0000 0008 and the sale lands in your Airwallex account." : "Available after steps 1 to 3: the agent needs products to sell, a wallet for its AI replies and your Airwallex account for the money."}
          </p>
          {s.done ? <a href={`/s/${shop.id}`} target="_blank" rel="noreferrer" className="btn btn-primario btn-chico">Open the chat</a> : null}
        </Step>
      </ol>
    </div>
  );
}
