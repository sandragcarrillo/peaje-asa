import { ImageResponse } from "next/og";
import { findProduct } from "@peaje-asa/policy";
import { getShop, policyOf } from "@/lib/shops";

export const dynamic = "force-dynamic";

/** A product's catalogue image for buyer agents: name, shop and price on a plain card. */
export async function GET(_: Request, { params }: { params: Promise<{ shop: string; sku: string }> }) {
  const { shop: shopId, sku } = await params;
  const shop = getShop(shopId);
  const policy = shop && policyOf(shop);
  const p = policy && findProduct(policy.catalog, decodeURIComponent(sku));
  if (!shop || !p) return new Response("not found", { status: 404 });
  const name = `${p.name}`;
  const by = `${shop.name}`;
  const price = `${p.listPrice.toFixed(2)} ${policy.currency}`;
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "space-between", padding: 64, background: "#f4efe6", color: "#2a1d14", fontSize: 40 }}>
        <div style={{ display: "flex", fontSize: 28, color: "#7a5a3a" }}>{by}</div>
        <div style={{ display: "flex", fontSize: 64, fontWeight: 700, lineHeight: 1.1 }}>{name}</div>
        <div style={{ display: "flex", fontSize: 44 }}>{price}</div>
      </div>
    ),
    { width: 800, height: 800, headers: { "Cache-Control": "public, max-age=3600" } },
  );
}
