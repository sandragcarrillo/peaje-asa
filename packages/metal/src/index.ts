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

/** A provider's current 402 offer. */
export interface Offer { price: number; latencyMs: number }

/** Nothing was paid: the provider's price was above what we were willing to pay. */
export class PriceAboveCap extends Error {
  constructor(public provider: string, public price: number, public maxPrice: number) {
    super(`price_above_cap: ${provider} asks ${price} > ${maxPrice}`);
  }
}

/** The call was paid but no usable answer came back. The price is still a cost. */
export class PaidCallFailed extends Error {
  constructor(public provider: string, public pricePaid: number, public detail: string) {
    super(`paid_call_failed: ${provider} (${pricePaid}): ${detail}`);
  }
}

export interface InferencePayer {
  /** Ask a provider for its current price and latency (reads its 402 offer). */
  quote(provider: InferenceProvider): Promise<Offer>;
  /** Pay and call. Must be idempotent per job: resend the same request before rerouting. */
  payAndCall<T>(provider: InferenceProvider, payload: unknown, maxPrice: number): Promise<PaidCall<T>>;
}

/** Placeholder so the rest of the system can run end to end before Metal is wired. */
export class FakeInferencePayer implements InferencePayer {
  async quote(p: InferenceProvider): Promise<Offer> {
    const res = await fetch(p.url, { method: "POST" });
    return { price: Number(res.headers.get("x-price") ?? 0), latencyMs: Number(res.headers.get("x-latency-ms") ?? 0) };
  }
  async payAndCall<T>(p: InferenceProvider, payload: unknown, maxPrice: number): Promise<PaidCall<T>> {
    const { price } = await this.quote(p);
    if (price > maxPrice + 1e-9) throw new PriceAboveCap(p.id, price, maxPrice);
    const res = await fetch(p.url, { method: "POST", headers: { "x-paid": "1", "content-type": "application/json" }, body: JSON.stringify(payload) });
    if (!res.ok) throw new PaidCallFailed(p.id, price, `${res.status} ${await res.text()}`);
    return { provider: p.id, pricePaid: price, result: (await res.json()) as T };
  }
}
