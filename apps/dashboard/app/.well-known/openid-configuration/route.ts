import { oauthMetadata } from "@peaje-asa/storefront";
import { publicUrl } from "@/lib/storefront";

export const dynamic = "force-dynamic";
/** OIDC discovery for the buyer agents' OAuth server (Kit 10 asks for it at {oauth_base}/.well-known/openid-configuration). */
export const GET = () => Response.json(oauthMetadata(publicUrl()));
