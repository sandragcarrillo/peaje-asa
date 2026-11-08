/**
 * Shop owner login: email and a scrypt password hash stored with the shop. Anyone can sign up and open
 * a shop; each session names its shop. Every owner page, server action and route handler calls
 * requireOwner(); the proxy only redirects early.
 */
import "./env";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { Shop } from "@peaje-asa/ledger";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE, SESSION_HOURS, signSession, verifySession } from "./session-token";
import { getShop, shops } from "./shops";

export const loginConfigured = () => Boolean(process.env.SESSION_SECRET);

const SCRYPT = { N: 16384, r: 8, p: 1 } as const;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, 64, SCRYPT, (err, key) => (err ? reject(err) : resolve(key))));
}

/** scrypt.<salt>.<hash>, base64url: the format npm run keys:owner writes too. */
export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  return `scrypt.${salt.toString("base64url")}.${(await scryptAsync(password, salt)).toString("base64url")}`;
}

// A real hash of nothing, so an unknown email costs the same time as a wrong password.
const DUMMY = "scrypt.AAAAAAAAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split(".");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64url");
  const got = await scryptAsync(password, Buffer.from(salt, "base64url"));
  return got.length === expected.length && timingSafeEqual(got, expected);
}

// Failed attempts per client, in memory: 5 failures lock that client out for 15 minutes. Signups count too.
const MAX_FAILURES = 5;
const LOCK_MS = 15 * 60_000;
const failures = new Map<string, { count: number; until: number }>();

async function clientKey() {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0].trim() || h.get("x-real-ip") || "local";
}

function locked(client: string) {
  const f = failures.get(client);
  return f && f.count >= MAX_FAILURES && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60_000) : 0;
}

function fail(client: string) {
  const f = failures.get(client);
  failures.set(client, { count: f && f.until > Date.now() ? f.count + 1 : 1, until: Date.now() + LOCK_MS });
}

async function startSession(shop: Shop) {
  const exp = Date.now() + SESSION_HOURS * 3_600_000;
  const token = await signSession({ email: shop.ownerEmail, shopId: shop.id, exp }, process.env.SESSION_SECRET!);
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(exp),
  });
}

export type LoginResult = { error: string } | null;

export async function logIn(email: string, password: string): Promise<LoginResult> {
  if (!loginConfigured()) return { error: "Login isn't set up: SESSION_SECRET is missing. Run npm run keys:owner -- you@example.com and restart." };
  const client = await clientKey();
  const wait = locked(client);
  if (wait) return { error: `Too many attempts. Try again in ${wait} minutes.` };
  const shop = shops().byEmail(email);
  const ok = await passwordMatches(password, shop?.passwordHash ?? DUMMY);
  if (!shop || !ok) {
    fail(client);
    return { error: "Wrong email or password." };
  }
  failures.delete(client);
  await startSession(shop);
  return null;
}

/** Opens a new shop with this owner and signs them in. */
export async function signUp(input: { email: string; password: string; create: (passwordHash: string) => Shop }): Promise<LoginResult> {
  if (!loginConfigured()) return { error: "Signup isn't set up: SESSION_SECRET is missing." };
  const client = await clientKey();
  const wait = locked(client);
  if (wait) return { error: `Too many attempts. Try again in ${wait} minutes.` };
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "That email doesn't look right." };
  if (input.password.length < 12) return { error: "Use a password of 12 characters or more." };
  if (shops().byEmail(email)) {
    fail(client);
    return { error: "That email already has a shop. Sign in instead." };
  }
  const shop = input.create(await hashPassword(input.password));
  fail(client); // a burst of signups from one client is throttled like failed logins
  await startSession(shop);
  return null;
}

export async function logOut() {
  (await cookies()).delete(SESSION_COOKIE);
}

/** The signed-in owner and their shop, or null. A session whose shop is gone or changed owner is no session. */
export async function currentOwner(): Promise<{ email: string; shop: Shop } | null> {
  const s = await verifySession((await cookies()).get(SESSION_COOKIE)?.value, process.env.SESSION_SECRET);
  if (!s) return null;
  const shop = getShop(s.shopId);
  return shop && shop.ownerEmail === s.email ? { email: s.email, shop } : null;
}

/** The owner and their shop, or a redirect to the login page. */
export async function requireOwner(): Promise<{ email: string; shop: Shop }> {
  const o = await currentOwner();
  if (!o) redirect("/login");
  return o;
}
