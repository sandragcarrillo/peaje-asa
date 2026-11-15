import { headers } from "next/headers";
import { ActionForm } from "@/components/action-form";
import { CopySnippet } from "@/components/copy-snippet";
import { PageHead } from "@/components/page-head";
import { WebsiteSetup } from "@/components/website-setup";
import { requireOwner } from "@/lib/auth";
import { setupOf } from "@/lib/shops";
import { saveEmbedOriginsAction } from "./actions";

/** This app's public origin, for the code the owner pastes on their own website. */
async function appOrigin() {
  const fromEnv = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export default async function Plugin() {
  const { shop } = await requireOwner();
  const origin = await appOrigin();
  const sites = shop.embedOrigins ?? [];
  const ready = setupOf(shop).canSell;

  const sitesForm = (
    <ActionForm action={saveEmbedOriginsAction} label="Save" pendingLabel="Saving..." small>
      <label className="block text-sm">
        Your website address
        <textarea
          name="sites"
          rows={2}
          defaultValue={sites.join("\n")}
          placeholder="https://yourshop.com"
          className="mt-1.5 block w-full max-w-md resize-y rounded-lg border border-border bg-bg px-3 py-2 font-mono text-base outline-none focus:border-accent sm:text-sm"
        />
        <span className="mt-1 block text-xs text-muted">More than one? Put each on its own line.</span>
      </label>
    </ActionForm>
  );

  return (
    <section className="max-w-3xl space-y-10">
      <PageHead
        eyebrow={`${shop.name} · plugin`}
        title="Add your chat to your website"
        sub="A chat button in the corner of your site. It opens the same agent as your chat link: same products, same rules, same payment links."
      />

      {!ready ? (
        <p className="border border-accent bg-panel p-4 text-sm">Your shop isn&apos;t open yet. Finish the steps on Overview first; until then the button says the shop is getting ready.</p>
      ) : null}

      <WebsiteSetup shopId={shop.id} origin={origin} sites={sites} sitesForm={sitesForm} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-border bg-panel p-5">
          <h2 className="font-semibold">No website?</h2>
          <p className="text-sm text-muted">Share your chat link instead: in your Instagram bio, your WhatsApp Business profile or anywhere you post.</p>
          <CopySnippet code={`${origin}/s/${shop.id}`} />
        </div>
        <div className="space-y-2 rounded-lg border border-border bg-panel p-5">
          <h2 className="font-semibold">How buyers pay</h2>
          <p className="text-sm text-muted">
            The agent sends a payment link and the buyer pays on Airwallex&apos;s page. An order counts as paid only when Airwallex confirms it,
            even if the buyer closed the chat. A screenshot or an &quot;I paid&quot; never marks an order paid.
          </p>
        </div>
      </div>
    </section>
  );
}
