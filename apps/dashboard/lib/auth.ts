/**
 * Owner login: one email and a scrypt password hash from .env (npm run keys:owner). Every owner page,
 * server action and route handler calls requireOwner(); the proxy only redirects early.
 */
import "./env";
import { scrypt, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession } from "./session-token";

const ownerEmail = () => process.env.OWNER_EMAIL?.trim().toLowerCase();
export const loginConfigured = () => Boolean(ownerEmail() && process.env.OWNER_PASSWORD_HASH && process.env.SESSION_SECRET);

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 64, { N: 16384, r: 8, p: 1 }, (err, key) => (err ? reject(err) : resolve(key))));
}

/** Same format the key script writes: scrypt.<salt>.<hash>, base64url. */
async function passwordMatches(password: string): Promise<boolean> {
  const [scheme, salt, hash] = (process.env.OWNER_PASSWORD_HASH ?? "").split(".");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = await scryptAsync(password, Buffer.from(salt, "base64url"));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Failed attempts per client, in memory: 5 failures lock that client out for 15 minutes.
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

export type LoginResult = { error: string } | null;

export async function logIn(email: string, password: string): Promise<LoginResult> {
  if (!loginConfigured()) return { error: "Owner login isn't set up. Run npm run keys:owner -- you@example.com and restart the dashboard." };
  const client = await clientKey();
  const f = failures.get(client);
  if (f && f.count >= MAX_FAILURES && f.until > Date.now()) {
    return { error: `Too many attempts. Try again in ${Math.ceil((f.until - Date.now()) / 60_000)} minutes.` };
  }
  // The hash always runs, so a wrong email takes as long as a wrong password.
  const passwordOk = await passwordMatches(password);
  if (!passwordOk || email.trim().toLowerCase() !== ownerEmail()) {
    const count = f && f.until > Date.now() ? f.count + 1 : 1;
    failures.set(client, { count, until: Date.now() + LOCK_MS });
    return { error: "Wrong email or password." };
  }
  failures.delete(client);
  const exp = Date.now() + SESSION_HOURS * 3_600_000;
  const token = await signSession({ email: ownerEmail()!, exp }, process.env.SESSION_SECRET!);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(exp),
  });
  return null;
}

export async function logOut() {
  (await cookies()).delete(SESSION_COOKIE);
}

export async function currentOwner() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return verifySession(token, process.env.SESSION_SECRET, ownerEmail());
}

/** The owner's email, or a redirect to the login page. */
export async function requireOwner(): Promise<string> {
  const s = await currentOwner();
  if (!s) redirect("/login");
  return s.email;
}
