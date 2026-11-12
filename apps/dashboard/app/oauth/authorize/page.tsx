import { OAuthError } from "@peaje-asa/storefront";
import { Etiqueta } from "@/components/etiqueta";
import { oauth } from "@/lib/storefront";
import { SignInForm } from "./sign-in-form";

export const dynamic = "force-dynamic";

const FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope"] as const;

/** Where a buyer's Claude sends the shopper to sign in before it shops the platform's stores. */
export default async function Authorize({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const req = Object.fromEntries(FIELDS.map((k) => [k, typeof sp[k] === "string" ? sp[k] : ""])) as Record<(typeof FIELDS)[number], string>;
  let clientName = "";
  let error = "";
  try {
    clientName = oauth().check(req).client_name;
  } catch (e) {
    if (!(e instanceof OAuthError)) throw e;
    error = e.description;
  }
  return (
    <main className="mx-auto max-w-5xl px-6 pt-10 pb-20">
      <div className="flex min-h-[65vh] items-center justify-center">
        <div className="w-full max-w-sm border border-border bg-panel p-6 sm:p-8">
          <Etiqueta dot>Peaje ASA shops</Etiqueta>
          {error ? (
            <>
              <h1 className="mt-3 text-2xl font-semibold">This sign-in link doesn't work</h1>
              <p role="alert" className="mt-2 text-sm text-red-400">{error}. Start again from your assistant.</p>
            </>
          ) : (
            <>
              <h1 className="mt-3 text-2xl font-semibold">Shop with {clientName}</h1>
              <p className="mt-2 text-sm text-muted">
                {clientName} will search the shops' products and start checkouts for you. You pay on Airwallex's page; your card never reaches the assistant or the shop.
              </p>
              <SignInForm fields={req} />
            </>
          )}
        </div>
      </div>
    </main>
  );
}
