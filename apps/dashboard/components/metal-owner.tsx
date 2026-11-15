"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
      <p className="text-sm font-semibold">How much can your agents spend?</p>
      <p className="text-sm text-muted">Amounts in USDZ, a test dollar. Your agents can&apos;t spend more than this, and only on what&apos;s listed.</p>
      <ul className="list-disc space-y-1.5 pl-5 text-sm">{approval.summary.map((s, i) => <li key={i}>{s}</li>)}</ul>
      <button type="button" onClick={approve} disabled={busy} className="btn btn-primario">{busy ? "Approving..." : "Approve"}</button>
      <p className="text-xs text-muted">Your browser signs this with your key. Until you approve, your agents can&apos;t spend anything.</p>
      <details className="text-[11px] text-faint">
        <summary className="cursor-pointer">Technical details</summary>
        <p className="mt-1 break-all font-mono">Alta account {approval.account} · digest {approval.digest.slice(0, 18)}… · valid until {expires}</p>
      </details>
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

/**
 * First time: the owner's key is made here, saved to a file, and approves the agents' mandates.
 * `auto` (a "Try it" shop): the same steps run on their own as soon as the page opens. The key is
 * still made and kept in this browser and still signs the limits; there's just no backup file and no click.
 */
export function MetalSetup({ shopId, metalOwner, pending, auto = false }: { shopId: string; metalOwner?: string; pending?: Approval; auto?: boolean }) {
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
    if (!auto) downloadBackup(k);
    setKey(k);
    await start(k);
  }

  // Auto: make the key (or pick up the one already here), then sign the limits as soon as they're ready.
  const ran = useRef(false);
  useEffect(() => {
    if (!auto || key === undefined || ran.current) return;
    if (key === null && metalOwner) return;
    ran.current = true;
    (key === null ? create() : approval ? Promise.resolve() : start(key)).catch((e) => setResult({ ok: false, message: (e as Error).message }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, key]);
  const signed = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!auto || !key || !approval || signed.current === approval.digest) return;
    signed.current = approval.digest;
    (async () => {
      setBusy(true);
      try {
        const r = await approveAction(approval.kind, approval.digest, await signApproval(key, approval));
        if (r.ok && key.account === undefined && r.account) await saveKey({ ...key, account: r.account as `0x${string}` });
        setResult(r.ok ? { ...r, message: "Your browser signed these limits with your key:", lines: [...approval.summary, ...(r.lines ?? [])] } : r);
        if (r.ok) { setApproval(undefined); router.refresh(); }
      } catch (e) {
        setResult({ ok: false, message: (e as Error).message });
      } finally {
        setBusy(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto, key, approval]);

  if (key === undefined) return <p className="text-sm text-muted">Looking for your key in this browser...</p>;
  if (auto && (key !== null || !metalOwner)) return (
    <div className="space-y-3">
      <p className="text-sm text-muted">{busy || !result ? "Setting it up now: your browser made your key and is creating the wallet and signing its limits. About a minute." : null}</p>
      <Result r={result} />
    </div>
  );
  return (
    <div className="space-y-4">
      {key === null && !metalOwner ? (
        <>
          <p className="text-sm text-muted">Your browser creates your approval key and saves a backup file. Keep the file: it&apos;s the only copy, and we never see it. Then you approve your agent&apos;s limits. About a minute.</p>
          <button type="button" onClick={create} disabled={busy} className="btn btn-primario">{busy ? "Creating your wallet..." : "Create the wallet"}</button>
        </>
      ) : key === null ? (
        <>
          <p className="text-sm text-muted">Your key isn't in this browser. Load the file that downloaded when you created the wallet.</p>
          <RestoreKey shopId={shopId} onKey={setKey} />
        </>
      ) : approval ? null : (
        <>
          <p className="text-sm text-muted">Your key is in this browser. Pick up where the setup stopped.</p>
          <button type="button" onClick={() => start(key)} disabled={busy} className="btn btn-primario">{busy ? "Working..." : "Continue"}</button>
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
