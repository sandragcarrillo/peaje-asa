import { OAuthError } from "@peaje-asa/storefront";
import { oauth } from "@/lib/storefront";

export const dynamic = "force-dynamic";
/** Dynamic client registration (RFC 7591), for the buyer's Claude. */
export async function POST(req: Request) {
  try {
    return Response.json(oauth().register(await req.json()), { status: 201 });
  } catch (e) {
    if (e instanceof OAuthError) return Response.json(e.body(), { status: e.status });
    return Response.json({ error: "invalid_client_metadata", error_description: "expected JSON" }, { status: 400 });
  }
}
