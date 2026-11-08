import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ShopChat } from "@/components/shop-chat";
import { getShop } from "@/lib/shops";
import "../chat.css";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ shop: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shop = getShop((await params).shop);
  return { title: shop ? `${shop.name} chat` : "Shop not found" };
}

/** The shop's public chat: anyone can write, the seller agent answers within the owner's rules. */
export default async function ShopPage({ params }: Props) {
  const shop = getShop((await params).shop);
  if (!shop) notFound();
  return <ShopChat shop={{ id: shop.id, name: shop.name, about: shop.about }} />;
}
