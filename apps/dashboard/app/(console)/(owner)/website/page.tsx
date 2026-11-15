import { headers } from "next/headers";
import { ActionForm } from "@/components/action-form";
import { CopySnippet } from "@/components/copy-snippet";
import { PageHead } from "@/components/page-head";
import { requireOwner } from "@/lib/auth";
import { setupOf } from "@/lib/shops";
import { saveEmbedOriginsAction } from "./actions";

/** This app's public origin, for the snippet the owner pastes on their own website. */
async function appOrigin() {
  const fromEnv = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (fromEnv) return fromEnv;
  const h = await headers();
  return `${h.get("x-forwarded-proto") ?? "http"}://${h.get("host")}`;
}

export default async function Website() {
  const { shop } = await requireOwner();
  const origin = await appOrigin();
  const sites = shop.embedOrigins ?? [];
  const ready = setupOf(shop).canSell;
  const snippet = `<script src="${origin}/widget.js" data-shop="${shop.id}" async></script>`;

  return (
    <section className="max-w-3xl space-y-8">
      <PageHead
        eyebrow={`${shop.name} · website`}
        title="Chat on your website"
        sub="A chat button in the corner of your own site. It opens the same agent as your shop's chat link: same products, same rules, same payment links."
      />

      {!ready ? (
        <p className="border border-accent bg-panel p-4 text-sm">Your shop isn't open yet. Finish the steps on Overview first; until then the button shows that the shop is getting ready.</p>
      ) : null}

      <ol className="space-y-6">
        <li className="space-y-3 border border-border bg-panel p-5">
          <h2 className="font-semibold">1. Say where it may appear</h2>
          <p className="text-sm text-muted">
            Only these websites can show your chat. If someone copies the code onto another site, the button doesn't show up there. One address per line, for example https://yourshop.com.
          </p>
          <ActionForm action={saveEmbedOriginsAction} label="Save websites" pendingLabel="Saving..." small>
            <label className="block text-sm">
              Your websites
              <textarea
                name="sites"
                rows={3}
                defaultValue={sites.join("\n")}
                placeholder="https://yourshop.com"
                className="mt-1.5 block w-full resize-y rounded-lg border border-border bg-bg px-3 py-2 font-mono text-base outline-none focus:border-accent sm:text-sm"
              />
            </label>
          </ActionForm>
        </li>

        <li className="space-y-3 border border-border bg-panel p-5">
          <h2 className="font-semibold">2. Paste this line on your website</h2>
          <p className="text-sm text-muted">Before the closing &lt;/body&gt; tag, on every page where you want the button.</p>
          <CopySnippet code={snippet} />
          <p className="text-xs text-muted">Optional: data-label=&quot;Ask us&quot; changes the button text, data-color=&quot;#1a56c4&quot; its color.</p>
        </li>

        <li className="space-y-2 border border-border bg-panel p-5">
          <h2 className="font-semibold">3. How buyers pay</h2>
          <p className="text-sm text-muted">
            The agent sends a payment link and the buyer pays on Airwallex&apos;s page. An order counts as paid only when Airwallex confirms the payment,
            even if the buyer closed the chat. A screenshot or a message saying &quot;I paid&quot; never marks an order paid.
          </p>
          <a href={`/embed/${shop.id}`} target="_blank" rel="noreferrer" className="btn btn-secundario btn-chico">See the chat as it shows in the widget</a>
        </li>
      </ol>
    </section>
  );
}
