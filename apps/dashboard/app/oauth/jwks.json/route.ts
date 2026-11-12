import { oauthKey } from "@/lib/storefront";

export const dynamic = "force-dynamic";
/** The public key Airwallex checks our access tokens with. */
export const GET = () => Response.json(oauthKey().jwks());
