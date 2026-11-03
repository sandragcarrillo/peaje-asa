/**
 * Signed orders. Once a payment is verified we sign the exact order (items, prices,
 * total, currency, payment intent) with the business's Ed25519 key. Anyone holding
 * the public key can check the record wasn't changed after the sale, which is what
 * the treasury agent hands over when a customer disputes the charge.
 */
import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import type { SignedOrder } from "./index.js";

export type OrderTerms = Omit<SignedOrder, "signature" | "signerPublicKey">;

/** Stable JSON: object keys sorted at every level, so the same order always signs the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export class OrderSigner {
  private constructor(private privateKey: KeyObject, readonly publicKeyPem: string) {}

  /** ORDER_SIGNING_KEY is a PKCS#8 PEM, base64-encoded onto one line for .env. */
  static fromEnv() {
    const b64 = process.env.ORDER_SIGNING_KEY;
    if (!b64) throw new Error("Missing ORDER_SIGNING_KEY (run `npm run keys:order`)");
    const privateKey = createPrivateKey(Buffer.from(b64, "base64").toString("utf8"));
    const publicKeyPem = createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString();
    return new OrderSigner(privateKey, publicKeyPem);
  }

  static generateEnvValue() {
    const { privateKey } = generateKeyPairSync("ed25519");
    return Buffer.from(privateKey.export({ type: "pkcs8", format: "pem" }).toString()).toString("base64");
  }

  sign(terms: OrderTerms): SignedOrder {
    const signature = sign(null, Buffer.from(canonicalJson(terms)), this.privateKey).toString("base64");
    return { ...terms, signature, signerPublicKey: this.publicKeyPem };
  }
}

/** True only if the order's terms are exactly what was signed. */
export function verifyOrder(order: SignedOrder, publicKeyPem = order.signerPublicKey): boolean {
  const { signature, signerPublicKey: _pk, ...terms } = order;
  return verify(null, Buffer.from(canonicalJson(terms)), createPublicKey(publicKeyPem), Buffer.from(signature, "base64"));
}
