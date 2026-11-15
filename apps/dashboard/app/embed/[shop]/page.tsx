import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShopChat } from "@/components/shop-chat";
import { getShop, setupOf } from "@/lib/shops";
import "../../s/chat.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ shop: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = getShop((await params).shop);
  return { title: shop ? `${shop.name} chat` : "Shop not found", robots: { index: false } };
}

/**
 * The shop's chat inside the widget on the shop's own website (public/widget.js opens it in a frame).
 * Which websites may frame it is the shop's list, enforced by the proxy with frame-ancestors.
 */
export default async function EmbedPage({ params }: Props) {
  const shop = getShop((await params).shop);
  if (!shop) notFound();
  return <ShopChat shop={{ id: shop.id, name: shop.name, about: shop.about }} ready={setupOf(shop).canSell} embedded />;
}
