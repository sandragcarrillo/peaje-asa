"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { isAddressEqual } from "viem";
import { approveAction, prepareRebalanceAction, startMetalSetupAction, type Approval, type MetalStep } from "@/app/(console)/(owner)/agents/actions";
import { downloadBackup, loadKey, newKey, readBackup, saveKey, signApproval, type OwnerKey } from "@/lib/owner-key";

/** The owner key for this shop in this browser: undefined while loading, null when there is none (or another one). */
function useOwnerKey(shopId: string, metalOwner?: string) {
  const [key, setKey] = useState<OwnerKey | null | undefined>(undefined);
  useEffect(() => {
    loadKey(shopId).then(
      (k) => setKey(k && (!metalOwner || isAddressEqual(k.address, metalOwner as `0x${string}`)) ? k : null),
      () => setKey(null),
    );
  }, [shopId, metalOwner]);
  return [key, setKey] as const;
}

function Result({ r }: { r: MetalStep | null }) {
  if (!r) return null;
  return (
    <div role="status" className={`border p-3 text-sm ${r.ok ? "border-border bg-bg" : "border-red-500/50 bg-red-500/10 text-red-300"}`}>
      <p>{r.message}</p>
      {r.lines?.length ? <ul className="mt-2 space-y-1 break-all font-mono text-xs text-muted">{r.lines.map((l, i) => <li key={i}>{l}</li>)}</ul> : null}
    </div>
  );
}

/** One batch for the owner to read and sign. */
function ApprovalCard({ approval, ownerKey, onDone }: { approval: Approval; ownerKey: OwnerKey; onDone: (r: MetalStep) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const expires = new Date(Number(approval.validUntil) * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  async function approve() {
    setBusy(true);
    setError(undefined);
    try {
      const signature = await signApproval(ownerKey, approval);
      const r = await approveAction(approval.kind, approval.digest, signature);
      if (r.ok && ownerKey.account === undefined && r.account) await saveKey({ ...ownerKey, account: r.account as `0x${string}` });
      onDone(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-3 border border-accent/60 bg-bg p-4">
      <p className="text-sm font-semibold">Your key signs this</p>
      <ul className="list-disc space-y-1 pl-5 text-sm">{approval.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <p className="break-all font-mono text-[11px] text-faint">account {approval.account} · digest {approval.digest.slice(0, 18)}… · valid until {expires}</p>
      <button type="button" onClick={approve} disabled={busy} className="btn btn-primario">{busy ? "Signing and sending..." : "Approve with my key"}</button>
      {error ? <p role="alert" className="text-sm text-red-400">{error}</p> : null}
    </div>
  );
}

function RestoreKey({ shopId, onKey }: { shopId: string; onKey: (k: OwnerKey) => void }) {
  const [error, setError] = useState<string>();
  return (
    <label className="block text-sm">
      Restore from the backup file
      <input
        type="file"
        accept="application/json,.json"
        className="mt-1.5 block text-sm"
        onChange={async (e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          try {
            const k = await readBackup(f, shopId);
            await saveKey(k);
            onKey(k);
          } catch (err) {
            setError((err as Error).message);
          }
        }}
      />
      {error ? <span role="alert" className="mt-1 block text-red-400">{error}</span> : null}
    </label>
  );
}

/** First time: the owner's key is made here, saved to a file, and approves the agents' mandates. */
export function MetalSetup({ shopId, metalOwner, pending }: { shopId: string; metalOwner?: string; pending?: Approval }) {
  const router = useRouter();
  const [key, setKey] = useOwnerKey(shopId, metalOwner);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MetalStep | null>(null);
  const [approval, setApproval] = useState<Approval | undefined>(pending);

  async function start(k: OwnerKey) {
    setBusy(true);
    try {
      const r = await startMetalSetupAction(k.address);
      if (r.account && !k.account) await saveKey({ ...k, account: r.account as `0x${string}` }).then(() => setKey({ ...k, account: r.account as `0x${string}` }));
      setResult(r);
      setApproval(r.approval);
      if (r.ok && !r.approval) router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    const k = newKey(shopId);
    await saveKey(k);
    downloadBackup(k);
    setKey(k);
    await start(k);
  }

  if (key === undefined) return <p className="text-sm text-muted">Looking for your key in this browser...</p>;
  return (
    <div className="space-y-4">
      {key === null && !metalOwner ? (
        <>
          <p className="text-sm text-muted">This makes your owner key here, in this browser, and saves a copy as a file on your computer. Keep that file: it's the only other copy, we never see the key. Then it creates your shop's Metal account and asks your key to approve one mandate per agent.</p>
          <button type="button" onClick={create} disabled={busy} className="btn btn-primario">{busy ? "Creating your account..." : "Create my owner key"}</button>
        </>
      ) : key === null ? (
        <>
          <p className="text-sm text-muted">Your shop's owner key isn't in this browser. Load the backup file you saved when you set it up.</p>
          <RestoreKey shopId={shopId} onKey={setKey} />
        </>
      ) : approval ? null : (
        <>
          <p className="text-sm text-muted">Your key is in this browser ({key.address.slice(0, 10)}…). Continue where setup stopped.</p>
          <button type="button" onClick={() => start(key)} disabled={busy} className="btn btn-primario">{busy ? "Working..." : "Continue setup"}</button>
        </>
      )}
      <Result r={result} />
      {key && approval ? <ApprovalCard approval={approval} ownerKey={key} onDone={(r) => { setResult(r); if (r.ok) { setApproval(undefined); router.refresh(); } }} /> : null}
    </div>
  );
}

/** Rebalance: the treasury plans, the owner's key approves the replacement. */
export function RebalancePanel({ shopId, metalOwner, pending }: { shopId: string; metalOwner?: string; pending?: Approval }) {
  const router = useRouter();
  const [key, setKey] = useOwnerKey(shopId, metalOwner);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<MetalStep | null>(null);
  const [approval, setApproval] = useState<Approval | undefined>(pending?.kind === "rebalance" ? pending : undefined);

  async function plan() {
    setBusy(true);
    try {
      const r = await prepareRebalanceAction();
      setResult(r);
      setApproval(r.approval);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <button type="button" onClick={plan} disabled={busy} className="btn btn-primario">{busy ? "Reading the chain..." : "Rebalance"}</button>
      <Result r={result} />
      {approval && key ? <ApprovalCard approval={approval} ownerKey={key} onDone={(r) => { setResult(r); if (r.ok) { setApproval(undefined); router.refresh(); } }} /> : null}
      {approval && key === null ? <RestoreKey shopId={shopId} onKey={setKey} /> : null}
    </div>
  );
}
