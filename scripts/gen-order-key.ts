/** Creates the Ed25519 key that signs orders and appends it to .env. Never overwrites an existing key. */
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { OrderSigner } from "../packages/ledger/src/index.js";

const path = ".env";
const current = existsSync(path) ? readFileSync(path, "utf8") : "";
if (/^ORDER_SIGNING_KEY=.+/m.test(current)) {
  console.log("ORDER_SIGNING_KEY already set in .env, leaving it alone.");
} else {
  const sep = current === "" || current.endsWith("\n") ? "" : "\n";
  appendFileSync(path, `${sep}ORDER_SIGNING_KEY=${OrderSigner.generateEnvValue()}\n`);
  console.log("Added ORDER_SIGNING_KEY to .env");
}
