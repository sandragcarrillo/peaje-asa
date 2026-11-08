/**
 * The owner's key never reaches this server. Each shop's Metal account has one owner: a key made and
 * kept in the owner's browser. The server only prepares what the account must approve (binding or
 * replacing mandates), the browser signs the account's own digest, and a platform key (the sponsor)
 * sends the signed batch and pays its gas. Without the owner's signature the account runs nothing.
 *
 * Mirrors `authorizeMandateCall` from @metalntwx/metal-pay, split in two so the signature can come
 * back over HTTP: prepare (digest from chain state) and submit (check the signer, then send).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { accountFactoryFor, metalNetwork, rpcUrlFor } from "@metalntwx/metal-pay";
import {
  ACCOUNT_BATCH_MODE,
  FEE_PER_GAS,
  assertMetalAccount,
  metalAccountAbi,
  metalAccountFactoryAbi,
  publicMessage,
  sendMandateCall,
  type MandateCall,
} from "@metalntwx/metal-pay/mandates";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  custom,
  defineChain,
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  hexToBigInt,
  http,
  isAddressEqual,
  parseAbiParameters,
  recoverAddress,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const NETWORK = metalNetwork("testnet")!;
/** Long enough for the owner to read and sign, short enough that a signature can't be held for later. */
const SIGNATURE_WINDOW_S = 900n;
// What executeSigned adds for a quorum of one address with a 65-byte signature (quorumGas in metal-pay, not exported).
const ONE_OWNER_QUORUM_GAS = 500_000n;

let client: PublicClient | undefined;
export function metalClient(): PublicClient {
  if (client) return client;
  const url = rpcUrlFor(NETWORK, process.env.METAL_RPC_URL, "set METAL_RPC_URL");
  const chain = defineChain({ id: NETWORK.chainId, name: "Metal testnet", nativeCurrency: { name: "Gas", symbol: "GAS", decimals: 18 }, rpcUrls: { default: { http: [url] } } });
  return (client = createPublicClient({ chain, transport: http(url) }) as PublicClient);
}
export const accountFactory = () => accountFactoryFor(NETWORK, undefined, "set the factory");
export const METAL_CHAIN_ID = NETWORK.chainId;

/** The platform key that sends owner-approved batches and pays their gas. It holds no authority over any account. */
export async function sponsorKey(path: string) {
  if (!existsSync(path)) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const privateKey = generatePrivateKey();
    await writeFile(path, `${JSON.stringify({ address: privateKeyToAccount(privateKey).address, privateKey }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
  }
  const { privateKey } = JSON.parse(await readFile(path, "utf8")) as { privateKey: Hex };
  return privateKeyToAccount(privateKey);
}

async function sendFrom(sponsor: ReturnType<typeof privateKeyToAccount>, call: MandateCall) {
  const c = metalClient();
  const wallet = createWalletClient({ account: sponsor, chain: c.chain!, transport: custom(c) });
  const hash = await sendMandateCall(c, wallet, call).catch((e) => { throw new Error(publicMessage(e)); });
  const receipt = await c.waitForTransactionReceipt({ hash, pollingInterval: 250 });
  if (receipt.status !== "success") throw new Error(`transaction ${hash} reverted`);
  return hash;
}

const hasCode = async (address: Address) => {
  const code = await metalClient().getCode({ address });
  return code !== undefined && code !== "0x";
};

/** The one-owner account the factory gives `owner`. Same owner, same address, every time. */
export function ownerAccountAddress(owner: Address): Promise<Address> {
  return metalClient().readContract({ address: accountFactory(), abi: metalAccountFactoryAbi, functionName: "predictAccount", args: [[owner], [1n], 1n] }) as Promise<Address>;
}

/** Deploys the owner's account, the sponsor paying. Creating it needs no signature: it only names the owner. */
export async function deployOwnerAccount(owner: Address, sponsor: ReturnType<typeof privateKeyToAccount>) {
  const account = await ownerAccountAddress(owner);
  if (await hasCode(account)) return { account, transaction: undefined };
  const transaction = await sendFrom(sponsor, {
    to: accountFactory(),
    data: encodeFunctionData({ abi: metalAccountFactoryAbi, functionName: "createAccount", args: [[owner], [1n], 1n] }),
    gas: 600_000n,
    maxFeePerGas: FEE_PER_GAS,
    maxPriorityFeePerGas: FEE_PER_GAS,
  });
  return { account, transaction };
}

/** A batch waiting for the owner's signature. Bigints as strings so it can be stored and sent to the browser. */
export interface PreparedOwnerCall {
  kind: string;
  account: Address;
  chainId: number;
  executionData: Hex;
  nonce: string;
  validUntil: string;
  gas: string;
  digest: Hex;
  /** What the owner is approving, in words, one line per call. */
  summary: string[];
  /** Anything the caller needs to finish once it's sent (file renames, the plan). */
  meta?: unknown;
}

/** The account's executeDigest for these calls, computed here, never asked from the RPC. */
export async function prepareOwnerCall(calls: readonly MandateCall[], kind: string, summary: string[], meta?: unknown): Promise<PreparedOwnerCall> {
  const c = metalClient();
  const [first] = calls;
  if (!first) throw new Error("no call to approve");
  const account = first.to;
  if (calls.some((x) => !isAddressEqual(x.to, account))) throw new Error("every call in one batch goes to the same account");
  await assertMetalAccount(c, account, accountFactory());
  // A fresh nonce lane per batch, top bit clear (the quorum's lanes), as authorizeMandateCall does.
  const lane = hexToBigInt(bytesToHex(crypto.getRandomValues(new Uint8Array(24)))) >> 1n;
  const sequence = (await c.readContract({ address: account, abi: metalAccountAbi, functionName: "nonces", args: [account, lane] })) as bigint;
  const nonce = (lane << 64n) | sequence;
  const validUntil = BigInt(Math.floor(Date.now() / 1000)) + SIGNATURE_WINDOW_S;
  const executionData = encodeAbiParameters(parseAbiParameters("(address target, uint256 value, bytes callData)[]"), [calls.map((x) => ({ target: account, value: 0n, callData: x.data }))]);
  const digest = ownerDigest({ account, chainId: NETWORK.chainId, executionData, nonce, validUntil });
  const gas = calls.reduce((s, x) => s + x.gas, 0n);
  return { kind, account, chainId: NETWORK.chainId, executionData, nonce: nonce.toString(), validUntil: validUntil.toString(), gas: gas.toString(), digest, summary, meta };
}

/** The typed data the owner signs. The browser computes the same digest from the same fields. */
export const ownerTypedData = (p: { account: Address; chainId: number; executionData: Hex; nonce: bigint; validUntil: bigint }) => ({
  domain: { name: "MetalAccount", version: "1", chainId: p.chainId, verifyingContract: p.account },
  types: { Execute: [{ name: "mode", type: "bytes32" }, { name: "executionData", type: "bytes" }, { name: "nonce", type: "uint256" }, { name: "validUntil", type: "uint64" }] },
  primaryType: "Execute" as const,
  message: { mode: ACCOUNT_BATCH_MODE as Hex, executionData: p.executionData, nonce: p.nonce, validUntil: p.validUntil },
});
const ownerDigest = (p: Parameters<typeof ownerTypedData>[0]) => hashTypedData(ownerTypedData(p));

/** Checks the signature is the owner's over this batch's digest, then sends it. Returns the transaction. */
export async function submitOwnerCall(p: PreparedOwnerCall, owner: Address, signature: Hex, sponsor: ReturnType<typeof privateKeyToAccount>) {
  if (BigInt(Math.floor(Date.now() / 1000)) > BigInt(p.validUntil) - 30n) throw new Error("this approval expired; prepare it again");
  const signer = await recoverAddress({ hash: p.digest, signature });
  if (!isAddressEqual(signer, getAddress(owner))) throw new Error("that signature isn't from this shop's owner key");
  const quorum = encodeAbiParameters(parseAbiParameters("bytes[], bytes[]"), [[owner], [signature]]);
  return sendFrom(sponsor, {
    to: p.account,
    data: encodeFunctionData({ abi: metalAccountAbi, functionName: "executeSigned", args: [ACCOUNT_BATCH_MODE, p.executionData, BigInt(p.nonce), BigInt(p.validUntil), quorum] }),
    gas: BigInt(p.gas) + ONE_OWNER_QUORUM_GAS,
    maxFeePerGas: FEE_PER_GAS,
    maxPriorityFeePerGas: FEE_PER_GAS,
  });
}
