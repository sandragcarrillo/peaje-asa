/**
 * The shop owner's Metal key, in the owner's browser only (IndexedDB, plus a backup file they save).
 * It signs the batches the shop's account runs. Before signing, the browser checks the batch itself:
 * every call goes to the shop's own account, and the digest is recomputed here, not taken from the
 * server.
 */
import { decodeAbiParameters, hashTypedData, isAddressEqual, parseAbiParameters, type Address, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Approval } from "@/app/(console)/(owner)/agents/actions";

export interface OwnerKey { shopId: string; address: Address; privateKey: Hex; account?: Address; createdAt: string }

const DB = "peaje-asa-owner";
const STORE = "keys";
/** executeSigned's batch mode, the same constant the account checks. */
const ACCOUNT_BATCH_MODE = "0x0100000000000000000000000000000000000000000000000000000000000000" as const;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "shopId" });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export const loadKey = (shopId: string) => tx<OwnerKey | undefined>("readonly", (s) => s.get(shopId));
export const saveKey = (k: OwnerKey) => tx("readwrite", (s) => s.put(k));

export function newKey(shopId: string): OwnerKey {
  const privateKey = generatePrivateKey();
  return { shopId, address: privateKeyToAccount(privateKey).address, privateKey, createdAt: new Date().toISOString() };
}

/** Saves the key as a file on the owner's computer. It's the only copy outside this browser. */
export function downloadBackup(k: OwnerKey) {
  const body = {
    note: "Owner key of your Peaje ASA shop's Metal account. Anyone with this file can approve payments from that account. Peaje ASA keeps no copy.",
    ...k,
  };
  const url = URL.createObjectURL(new Blob([`${JSON.stringify(body, null, 2)}\n`], { type: "application/json" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: `peaje-asa-owner-key-${k.shopId}.json` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function readBackup(file: File, shopId: string): Promise<OwnerKey> {
  const k = JSON.parse(await file.text()) as Partial<OwnerKey>;
  if (typeof k.privateKey !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(k.privateKey)) throw new Error("That file doesn't hold an owner key.");
  const address = privateKeyToAccount(k.privateKey as Hex).address;
  return { shopId, address, privateKey: k.privateKey as Hex, account: k.account, createdAt: k.createdAt ?? new Date().toISOString() };
}

/** Checks the batch is for this shop's account and signs the digest computed here. */
export async function signApproval(k: OwnerKey, a: Approval): Promise<Hex> {
  if (k.account && !isAddressEqual(k.account, a.account)) throw new Error("This approval is for another account than your shop's. Not signing.");
  const [calls] = decodeAbiParameters(parseAbiParameters("(address target, uint256 value, bytes callData)[]"), a.executionData);
  if (!calls.length || calls.some((c) => !isAddressEqual(c.target, a.account) || c.value !== 0n)) throw new Error("This batch calls something other than your account. Not signing.");
  const typed = {
    domain: { name: "MetalAccount", version: "1", chainId: a.chainId, verifyingContract: a.account },
    types: { Execute: [{ name: "mode", type: "bytes32" }, { name: "executionData", type: "bytes" }, { name: "nonce", type: "uint256" }, { name: "validUntil", type: "uint64" }] },
    primaryType: "Execute",
    message: { mode: ACCOUNT_BATCH_MODE, executionData: a.executionData, nonce: BigInt(a.nonce), validUntil: BigInt(a.validUntil) },
  } as const;
  if (hashTypedData(typed) !== a.digest) throw new Error("The batch doesn't match what the server asked to sign. Not signing.");
  return privateKeyToAccount(k.privateKey).signTypedData(typed);
}
