import assert from "node:assert/strict";
import { test } from "node:test";
import { hashTypedData, recoverAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { METAL_CHAIN_ID, ownerTypedData } from "./owner.js";

const batch = {
  account: "0x9502F5E714bee23b79158054c330B22f6Bc4f618" as const,
  chainId: METAL_CHAIN_ID,
  executionData: "0x1234" as const,
  nonce: 42n,
  validUntil: 1_900_000_000n,
};

test("the browser's typed-data signature recovers to the owner over the digest the server sends", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const typed = ownerTypedData(batch);
  const signature = await owner.signTypedData(typed);
  assert.equal(await recoverAddress({ hash: hashTypedData(typed), signature }), owner.address);
});

test("another key's signature, or the owner's over another batch, doesn't recover to the owner", async () => {
  const owner = privateKeyToAccount(generatePrivateKey());
  const other = privateKeyToAccount(generatePrivateKey());
  const digest = hashTypedData(ownerTypedData(batch));
  assert.notEqual(await recoverAddress({ hash: digest, signature: await other.signTypedData(ownerTypedData(batch)) }), owner.address);
  const elsewhere = await owner.signTypedData(ownerTypedData({ ...batch, nonce: 43n }));
  assert.notEqual(await recoverAddress({ hash: digest, signature: elsewhere }), owner.address);
});
