/**
 * Products and the sample catalog. Each shop keeps its own catalog in its policy; the sample is the
 * demo shop, a specialty coffee shop in Bogotá that sells beans and brewing gear.
 * List prices and unit costs are money rules, so they live here and never in prompts.
 * Small items carry wide margins; machines carry thin ones, which is where discounts get tight.
 */

export interface Product {
  sku: string;
  name: string;
  category: string;
  listPrice: number;
  unitCost: number;
  /** Taken off sale. Kept so quotes and orders that name it still resolve. */
  archived?: boolean;
}

export const sampleCatalog: readonly Product[] = [
  { sku: "BEAN-HUILA-250", name: "Huila washed, 250 g", category: "beans", listPrice: 14, unitCost: 6 },
  { sku: "BEAN-NARINO-250", name: "Nariño honey, 250 g", category: "beans", listPrice: 16, unitCost: 7 },
  { sku: "BEAN-SIERRA-1K", name: "Sierra Nevada blend, 1 kg", category: "beans", listPrice: 42, unitCost: 21 },
  { sku: "BEAN-GEISHA-100", name: "Geisha microlot, 100 g", category: "beans", listPrice: 38, unitCost: 22 },
  { sku: "BEAN-DECAF-500", name: "Sugarcane decaf, 500 g", category: "beans", listPrice: 24, unitCost: 11 },
  { sku: "BREW-V60", name: "Ceramic V60 dripper", category: "brewing", listPrice: 28, unitCost: 12 },
  { sku: "BREW-CHEMEX-6", name: "Chemex, 6 cups", category: "brewing", listPrice: 55, unitCost: 31 },
  { sku: "BREW-AEROPRESS", name: "AeroPress kit", category: "brewing", listPrice: 45, unitCost: 26 },
  { sku: "BREW-FILTERS-100", name: "Paper filters, 100", category: "accessories", listPrice: 8, unitCost: 3 },
  { sku: "ACC-KETTLE", name: "Gooseneck kettle", category: "accessories", listPrice: 65, unitCost: 38 },
  { sku: "ACC-SCALE", name: "Brewing scale with timer", category: "accessories", listPrice: 48, unitCost: 27 },
  { sku: "MACH-GRINDER", name: "Burr grinder", category: "machines", listPrice: 220, unitCost: 150 },
  { sku: "MACH-ESPRESSO-HOME", name: "Home espresso machine", category: "machines", listPrice: 480, unitCost: 330 },
  { sku: "MACH-ESPRESSO-PRO", name: "Two-group espresso machine (café)", category: "machines", listPrice: 3200, unitCost: 2300 },
  { sku: "MACH-COLDBREW-10L", name: "Cold brew tower, 10 L", category: "machines", listPrice: 390, unitCost: 260 },
];

export function findProduct(catalog: readonly Product[], sku: string): Product | undefined {
  return catalog.find((p) => p.sku === sku);
}

/** The shops "Try it" can open: a name, a line about it, its catalog, what the demo buyer agent buys there (each under its 50 USDZ cap) and what its first two customers write. */
export interface DemoShopKind { kind: string; label: string; name: string; about: string; catalog: readonly Product[]; buys: string[]; chats: string[][]; supplier: { name: string; description: string }; bills: { note: string; amount: number; inDays: number }[] }

export const demoShops: readonly DemoShopKind[] = [
  {
    kind: "coffee",
    label: "Coffee",
    name: "Andes Coffee Co.",
    about: "Colombian specialty coffee, brewing gear and espresso machines, shipped in the US",
    catalog: sampleCatalog,
    supplier: { name: "Andes Green Coffee Imports", description: "Green coffee imports sold to roasters" },
    bills: [{ note: "Green coffee, invoice 1042", amount: 48, inDays: 0 }, { note: "Green coffee, invoice 1043", amount: 52, inDays: 14 }],
    buys: ["BEAN-HUILA-250", "BREW-FILTERS-100", "BEAN-NARINO-250", "BEAN-HUILA-250", "BREW-FILTERS-100", "BEAN-DECAF-500", "BEAN-NARINO-250", "BREW-FILTERS-100", "BEAN-HUILA-250", "BREW-FILTERS-100"],
    chats: [
      ["Hi! I brew with a V60 at home. Which beans would you recommend? I like fruity coffee.", "Sounds good, I'll take two bags of the Nariño. Can you send me the payment link?", "Got it, thanks for the help! I'll pay from my laptop tonight."],
      ["Do you ship the home espresso machine to Miami? What's the best price you can do on it?", "If I buy it this week, can you do 400?"],
      ["Do you have decaf? My wife can't have caffeine after noon.", "Perfect, one bag of the decaf please. Send me the link.", "Thanks, that's all!"],
      ["I run a small café in Austin. How much for the two-group espresso machine?", "Could you do 2,900 if I pay today?"],
      ["What's the difference between the Huila and the Nariño?", "Makes sense, I'll think about it. Thanks!"],
      ["I need a gift for my dad who just got into coffee, around 60 dollars. Ideas?", "Great, let's do the AeroPress kit and a bag of Huila. Send me one link for both.", "Perfect, thank you!"],
      ["Can I get 10 bags of the Sierra Nevada blend for my office? Any discount for that many?"],
      ["Is the Geisha worth it? 38 for 100 grams sounds like a lot.", "Ok, maybe for a special occasion. Thanks for being honest!"],
      ["I want the burr grinder and the gooseneck kettle together. Send me one link for both please.", "Great, thanks!"],
      ["Hi, do you sell the cold brew tower? How long does shipping take to New York?", "Ok, no rush. I'll come back next month. Thanks!"],
    ],
  },
  {
    kind: "skincare",
    label: "Skincare",
    name: "Selva Skincare",
    about: "Natural skincare made in Colombia with Amazon botanicals, shipped in the US",
    supplier: { name: "Amazonia Botanicals Lab", description: "Contract manufacturer of natural skincare" },
    bills: [{ note: "Serums and creams, invoice 318", amount: 42, inDays: 0 }, { note: "Sunscreen batch, invoice 319", amount: 39, inDays: 10 }],
    catalog: [
      { sku: "SKIN-LIP-BALM", name: "Cacao lip balm", category: "body", listPrice: 9, unitCost: 2 },
      { sku: "SKIN-CLEANSER", name: "Gentle gel cleanser, 150 ml", category: "face", listPrice: 22, unitCost: 7 },
      { sku: "SKIN-MASK", name: "Amazon clay mask, 100 g", category: "face", listPrice: 24, unitCost: 7 },
      { sku: "SKIN-SPF50", name: "Mineral sunscreen SPF 50, 50 ml", category: "face", listPrice: 26, unitCost: 8 },
      { sku: "SKIN-LOTION", name: "Body lotion with copoazú, 250 ml", category: "body", listPrice: 28, unitCost: 9 },
      { sku: "SKIN-MOIST", name: "Daily moisturizer, 50 ml", category: "face", listPrice: 32, unitCost: 10 },
      { sku: "SKIN-SERUM", name: "Vitamin C serum, 30 ml", category: "face", listPrice: 38, unitCost: 12 },
      { sku: "SKIN-OIL", name: "Sacha inchi face oil, 30 ml", category: "face", listPrice: 44, unitCost: 15 },
      { sku: "SKIN-ROUTINE", name: "Morning routine set (cleanser, serum, SPF)", category: "sets", listPrice: 79, unitCost: 30 },
      { sku: "SKIN-GIFT", name: "Full gift box, 7 products", category: "sets", listPrice: 160, unitCost: 75 },
    ],
    buys: ["SKIN-LIP-BALM", "SKIN-CLEANSER", "SKIN-LIP-BALM", "SKIN-SPF50", "SKIN-LIP-BALM", "SKIN-MASK", "SKIN-LIP-BALM", "SKIN-CLEANSER", "SKIN-LIP-BALM", "SKIN-LIP-BALM"],
    chats: [
      ["Hi! I have oily skin and live somewhere very sunny. What would you recommend for my mornings?", "Great, I'll take the morning set. Can you send me the link to pay?", "Perfect, thanks! I'll pay later today."],
      ["I want the full gift box for my mom's birthday. Can you do a better price if I buy two?", "What about 260 for both?"],
      ["Is the sunscreen safe for sensitive skin? I react to almost everything.", "Good to know, thank you!"],
      ["Do you test on animals?", "Great, thanks for answering."],
      ["I'd like the vitamin C serum and the moisturizer. One payment link for both please.", "Thank you!"],
      ["My skin gets really dry in winter. What should I use at night?", "Ok, the face oil then. How do I pay?", "Done, thanks!"],
      ["Can I get a discount on the routine set? I've bought from you before.", "Would you do 65?"],
      ["How long does a 30 ml serum last if I use it every day?", "Perfect, thanks!"],
      ["Do you ship to Canada?", "Ok, thanks anyway!"],
      ["I need 20 lip balms as favors for my wedding. What's the price for that many?"],
    ],
  },
  {
    kind: "running",
    label: "Running gear",
    name: "Cumbre Running",
    about: "Trail and road running shoes, clothing and gear, shipped in the US",
    supplier: { name: "Summit Outdoor Wholesale", description: "Wholesale running shoes, apparel and gear" },
    bills: [{ note: "Shoes and gear, invoice 77", amount: 36, inDays: 0 }, { note: "Spring shoes, invoice 78", amount: 60, inDays: 21 }],
    catalog: [
      { sku: "RUN-GEL", name: "Energy gel, single", category: "nutrition", listPrice: 3, unitCost: 1.2 },
      { sku: "RUN-TABS", name: "Electrolyte tablets, tube of 20", category: "nutrition", listPrice: 9, unitCost: 3 },
      { sku: "RUN-SOCKS", name: "Merino running socks, 2 pairs", category: "accessories", listPrice: 18, unitCost: 6 },
      { sku: "RUN-BOTTLE", name: "Soft flask, 500 ml", category: "accessories", listPrice: 22, unitCost: 7 },
      { sku: "RUN-CAP", name: "Light running cap", category: "accessories", listPrice: 28, unitCost: 9 },
      { sku: "RUN-SHIRT", name: "Technical tee", category: "clothing", listPrice: 42, unitCost: 16 },
      { sku: "RUN-HEADLAMP", name: "Headlamp, 400 lumens", category: "accessories", listPrice: 45, unitCost: 22 },
      { sku: "RUN-SHORTS", name: "Trail shorts with pockets", category: "clothing", listPrice: 48, unitCost: 20 },
      { sku: "RUN-VEST", name: "Hydration vest, 8 L", category: "gear", listPrice: 95, unitCost: 52 },
      { sku: "RUN-JACKET", name: "Waterproof running jacket", category: "clothing", listPrice: 140, unitCost: 80 },
      { sku: "RUN-SHOES", name: "Trail running shoes", category: "shoes", listPrice: 160, unitCost: 95 },
    ],
    buys: ["RUN-SOCKS", "RUN-GEL", "RUN-TABS", "RUN-BOTTLE", "RUN-GEL", "RUN-SOCKS", "RUN-TABS", "RUN-GEL", "RUN-SOCKS", "RUN-TABS"],
    chats: [
      ["Hi! I'm training for my first 14K trail race. What do I need besides shoes?", "Ok, I'll take the hydration vest and the socks. Send me one payment link for both please.", "Thanks, see you at the race!"],
      ["How much are the trail running shoes? Can you do a discount if I also buy the jacket?", "Can you do 260 for the shoes and the jacket together?"],
      ["Which headlamp do you have? I run before sunrise.", "Nice, I'll get it next week. Thanks!"],
      ["Are the trail shoes good for wide feet?", "Got it, thanks!"],
      ["I need 12 energy gels for a marathon. Send me a link for those.", "Thanks!"],
      ["What size should I get in the technical tee? I'm 1.75 m and 70 kg.", "Great, a medium then. How do I pay?", "Paid, thanks!"],
      ["My running club wants 15 caps with our logo. Can you do that, and at what price?"],
      ["Is the waterproof jacket breathable enough for running in the rain?", "Good to know, thank you."],
      ["Can you hold the hydration vest for me until Friday?", "Ok, no problem. Thanks!"],
      ["Do you have the shorts in women's sizes?", "Ok, I'll take one pair. Payment link please.", "Thank you!"],
    ],
  },
];
