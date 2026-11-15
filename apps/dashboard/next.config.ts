import type { NextConfig } from "next";

const config: NextConfig = {
  // Nothing but the widget's frame (/embed/<shop>, set per shop in proxy.ts) may be shown inside another site.
  async headers() {
    return [{ source: "/:path((?!embed/).*)", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'none'" }] }];
  },
  // Workspace packages are plain Node ESM (built with tsc -b) and use node:sqlite: load them at runtime, don't bundle.
  serverExternalPackages: ["@peaje-asa/seller-agent", "@peaje-asa/treasury-agent", "@peaje-asa/ledger", "@peaje-asa/airwallex", "@peaje-asa/metal", "@peaje-asa/policy", "@peaje-asa/storefront", "@metalntwx/metal-pay", "@x402/core"],
};

export default config;
