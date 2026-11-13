import { sellOverMetal } from "@/lib/metal-buy";

export const dynamic = "force-dynamic";

/** One item, paid in USDZ on Metal by a buyer agent under its mandate. Unpaid, it answers the 402 offer. */
export async function POST(req: Request, { params }: { params: Promise<{ shop: string; sku: string }> }) {
  const { shop, sku } = await params;
  return sellOverMetal(req, shop, decodeURIComponent(sku));
}
