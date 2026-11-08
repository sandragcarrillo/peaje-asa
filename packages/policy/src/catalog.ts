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
