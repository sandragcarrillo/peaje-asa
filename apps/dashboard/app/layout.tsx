import type { Metadata } from "next";
import { Hanken_Grotesk, Space_Mono } from "next/font/google";
import "./globals.css";

const sans = Hanken_Grotesk({ variable: "--font-grotesca", subsets: ["latin"] });
const mono = Space_Mono({ variable: "--font-chrome", weight: ["400", "700"], subsets: ["latin"] });

export const metadata: Metadata = { title: "Peaje ASA", description: "Seller agents that close sales, run their own books, and pay the business." };

/** Bare frame: the back office (console) and the public shop chats (/s/...) each bring their own chrome. */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className={`${sans.variable} ${mono.variable} antialiased`}>{children}</body>
    </html>
  );
}
