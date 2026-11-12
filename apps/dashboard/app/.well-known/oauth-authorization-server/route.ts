import { oauthMetadata } from "@peaje-asa/storefront";
import { publicUrl } from "@/lib/storefront";

export const dynamic = "force-dynamic";
/** RFC 8414 metadata, the same document as the OIDC discovery, for clients that look here first. */
export const GET = () => Response.json(oauthMetadata(publicUrl()));
