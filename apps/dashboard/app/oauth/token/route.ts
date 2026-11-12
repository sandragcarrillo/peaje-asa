import { OAuthError } from "@peaje-asa/storefront";
import { oauth } from "@/lib/storefront";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };

/** Token endpoint: authorization code with PKCE, or a refresh token. Form-encoded per RFC 6749; JSON accepted too. */
export async function POST(req: Request) {
  const type = req.headers.get("content-type") ?? "";
  const form: Record<string, string> = type.includes("application/json")
    ? await req.json().catch(() => ({}))
    : Object.fromEntries(new URLSearchParams(await req.text()));
  try {
    return Response.json(oauth().exchange(form), { headers: noStore });
  } catch (e) {
    if (e instanceof OAuthError) return Response.json(e.body(), { status: e.status, headers: noStore });
    throw e;
  }
}
