"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import type { DemoRun } from "@/lib/demo-history";

type State = "done" | "now" | "next" | "failed";

function Row({ state, children }: { state: State; children: React.ReactNode }) {
  const dot = { done: "bg-[#25d366]", now: "bg-accent animate-pulse", next: "bg-border", failed: "bg-red-400" }[state];
  return (
    <li className="flex gap-3">
      <span aria-hidden className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${dot}`} />
      <span className={state === "next" ? "text-muted" : ""}>{children}</span>
    </li>
  );
}

/**
 * What's happening in a demo shop, in plain words: the buyer agent's purchases, the first customers'
 * chats, then the judge's turn. While something is still running the page reloads its data every few
 * seconds, for ten minutes at most.
 */
export function DemoBanner({ run, ready, sold, talked, fresh, approvals, disputes, cardSales, closedBooks }: { run?: DemoRun; ready: boolean; closedBooks: boolean; sold: number; talked: number; fresh: boolean; approvals: number; disputes: number; cardSales: number }) {
  const router = useRouter();
  const path = usePathname();
  // The books say what happened; the run (this server's memory) only says what's still going on.
  const sales: State = run?.selling || (sold === 0 && fresh && !run?.error) ? "now" : sold > 0 ? "done" : "failed";
  const chats: State = run?.chatting ? "now" : talked > 0 ? "done" : !ready ? "next" : fresh && !run?.error ? "now" : "failed";
  const close: State = run?.closing ? "now" : run?.closed || closedBooks ? "done" : "next";
  const dispute: State = disputes > 0 ? "done" : run?.disputing ? "now" : "next";
  const busy = (fresh || Boolean(run?.selling || run?.chatting || run?.closing || run?.disputing)) && (sales === "now" || chats === "now" || chats === "next" || close === "now" || dispute === "now");

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => (Date.now() - started > 600_000 ? clearInterval(t) : router.refresh()), 4000);
    return () => clearInterval(t);
  }, [busy, router]);


  // Outside Overview: one line, so each page keeps its own first screen.
  if (path !== "/") {
    const going = [sales, chats, close, dispute].some((x) => x === "now");
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-panel px-4 py-2.5 text-sm">
        <span aria-hidden className={`h-2 w-2 rounded-full ${going ? "bg-accent animate-pulse" : "bg-[#25d366]"}`} />
        <span className="font-medium">Demo shop</span>
        <span className="text-muted">{sold} agent purchases · {talked} customer chats{approvals ? ` · ${approvals} waiting for your approval` : ""}{disputes ? ` · ${disputes} dispute${disputes === 1 ? "" : "s"}` : ""}</span>
        <Link href="/" className="ml-auto underline">What&apos;s happening</Link>
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-accent bg-panel p-5">
      <h2 className="font-semibold">Your demo shop is live</h2>
      <p className="mt-1 text-sm text-muted">Everything here really happens, with test money: Airwallex sandbox for cards, Alta testnet for agent payments.</p>
      <ol className="mt-4 space-y-2.5 text-sm">
        <Row state={sales}>
          {sales === "done"
            ? <>A buyer agent bought {sold} {sold === 1 ? "item" : "items"} from your shop and paid in USDZ on Alta. They&apos;re in your sales below.</>
            : sales === "now" ? <>A buyer agent is buying from your shop on Alta ({sold} of {run?.buys ?? 10} paid so far)...</>
            : sales === "failed" ? <>The buyer agent couldn&apos;t finish its purchases. Your shop works anyway.</>
            : <>A buyer agent is about to buy from your shop.</>}
        </Row>
        <Row state={chats}>
          {chats === "done"
            ? <>{talked === 1 ? "A customer" : `${talked} customers`} chatted with your agent. <Link href="/conversations" className="underline">Read the conversations</Link>.</>
            : chats === "now" ? <>Customers are writing to your shop and your agent is answering them ({talked} of {run?.chats ?? 10} so far)...</>
            : chats === "failed" ? <>A customer&apos;s chat didn&apos;t finish. You can still chat with your shop yourself.</>
            : <>Ten customers will write in as soon as your agent&apos;s wallet is ready.</>}
        </Row>
        <Row state={close}>
          {close === "done"
            ? <>The day&apos;s close ran: the sales moved to your Airwallex account, and the agent lined up what&apos;s due, the <Link href="/suppliers" className="underline">supplier bill</Link> due today and your profit.{approvals > 0 ? <> {approvals === 1 ? "One is" : `${approvals} are`} above your approval limit and {approvals === 1 ? "waits" : "wait"} for you in <Link href="/approvals" className="underline">Approvals</Link>.</> : <> Both went out.</>}</>
            : close === "now" ? <>Closing the day: moving the sales to your Airwallex account and paying the supplier bill due today...</>
            : <>When the purchases are in, the day&apos;s close moves the money and pays the supplier bill that&apos;s due today.</>}
        </Row>
        <Row state={ready ? "now" : "next"}>
          Your turn: open your shop&apos;s chat, ask for something and pay with the test card <span className="font-mono">4035 5010 0000 0008</span>. Watch the sale land here.
        </Row>
        <Row state={cardSales > 0 ? dispute : "next"}>
          {dispute === "done"
            ? <>That customer opened a chargeback, and your disputes agent answered it with the order, the chat and the delivery. <Link href="/disputes" className="underline">See the dispute</Link>.</>
            : dispute === "now" ? <>Your customer is opening a chargeback on that payment. Your disputes agent will answer it...</>
            : <>A minute after you pay, that customer opens a chargeback, so you can watch your disputes agent defend the sale.</>}
        </Row>
      </ol>
    </section>
  );
}
