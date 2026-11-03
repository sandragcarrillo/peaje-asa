/**
 * Metal testnet side: paying inference providers in USDZ (Kit 12) and
 * agent spending mandates (Kit 11).
 * TODO: implement with @metalntwx/metal-pay (clearing wallet) and the metal-agent CLI.
 * Field-level details: Metal console > API Docs (console-testnet.metalntwx.com).
 * Notes from the builder guide:
 * - A provider's price is whatever its next 402 offer says. Set maxAmount to the dearest price we accept.
 * - Clearing wallets pay ~1 request every 3s on testnet; retry `between_epochs` after retry.ms.
 * - Fresh wallet + deposit per job. Unused float withdraws ~10 min after last payment.
 * - Airwallex sandbox can't receive stablecoins: send USDZ to our Metal address, record the hash,
 *   then simulate an Airwallex deposit with the hash as reference.
 */

export interface InferenceProvider {
  id: string;
  url: string;
}

export interface PaidCall<T> {
  provider: string;
  pricePaid: number; // USDZ major units (= USD, the business currency)
  result: T;
}

export interface InferencePayer {
  /** Ask a provider for its current price (reads its 402 offer). */
  quote(provider: InferenceProvider): Promise<number>;
  /** Pay and call. Must be idempotent per job: resend the same request before rerouting. */
  payAndCall<T>(provider: InferenceProvider, payload: unknown, maxPrice: number): Promise<PaidCall<T>>;
}

/** Placeholder so the rest of the system can run end to end before Metal is wired. */
export class FakeInferencePayer implements InferencePayer {
  async quote(p: InferenceProvider) {
    const res = await fetch(p.url, { method: "POST" });
    return Number(res.headers.get("x-price") ?? 0);
  }
  async payAndCall<T>(p: InferenceProvider, payload: unknown, maxPrice: number): Promise<PaidCall<T>> {
    const price = await this.quote(p);
    if (price > maxPrice) throw new Error(`price_above_cap: ${price} > ${maxPrice}`);
    const res = await fetch(p.url, { method: "POST", headers: { "x-paid": "1", "content-type": "application/json" }, body: JSON.stringify(payload) });
    return { provider: p.id, pricePaid: price, result: (await res.json()) as T };
  }
}
