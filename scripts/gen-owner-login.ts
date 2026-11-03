/**
 * Sets the dashboard's owner login in .env: OWNER_EMAIL, OWNER_PASSWORD_HASH (scrypt) and SESSION_SECRET.
 *   npm run keys:owner -- owner@example.com
 * Asks for the password without echoing it. Without a terminal it generates one and prints it once.
 * Running it again replaces the email and password; the session secret is kept unless it's missing.
 */
import { randomBytes, scryptSync } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error("Usage: npm run keys:owner -- owner@example.com");
  process.exit(1);
}

function askHidden(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
  let prompted = false;
  out._writeToOutput = (s) => { if (!prompted) { out.output.write(s); prompted = true; } };
  return new Promise((resolve) => rl.question(question, (answer) => { rl.close(); process.stdout.write("\n"); resolve(answer); }));
}

let password: string;
if (process.stdin.isTTY) {
  password = await askHidden("Owner password (12+ characters): ");
  if (password.length < 12) { console.error("Too short: use 12 characters or more."); process.exit(1); }
  if ((await askHidden("Again: ")) !== password) { console.error("The passwords don't match."); process.exit(1); }
} else {
  password = randomBytes(15).toString("base64url");
  console.log(`Generated password (shown once): ${password}`);
}

// Same parameters the dashboard verifies with (apps/dashboard/lib/auth.ts).
const salt = randomBytes(16);
const hash = scryptSync(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 });
const values: Record<string, string> = {
  OWNER_EMAIL: email,
  OWNER_PASSWORD_HASH: `scrypt.${salt.toString("base64url")}.${hash.toString("base64url")}`,
};

const path = ".env";
let env = existsSync(path) ? readFileSync(path, "utf8") : "";
if (!/^SESSION_SECRET=.+/m.test(env)) values.SESSION_SECRET = randomBytes(32).toString("base64url");
for (const [key, value] of Object.entries(values)) {
  const line = `${key}=${value}`;
  const re = new RegExp(`^${key}=.*$`, "m");
  env = re.test(env) ? env.replace(re, line) : `${env}${env === "" || env.endsWith("\n") ? "" : "\n"}${line}\n`;
}
writeFileSync(path, env, { mode: 0o600 });
console.log(`Owner login set for ${email}${values.SESSION_SECRET ? " (new SESSION_SECRET)" : ""}. Restart the dashboard to pick it up.`);
