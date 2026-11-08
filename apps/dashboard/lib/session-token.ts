/**
 * The shop owner's session cookie: `payload.signature`, HMAC-SHA256 over the payload with SESSION_SECRET.
 * Web Crypto only, so the proxy and the server code verify it the same way.
 */
export const SESSION_COOKIE = "asa_session";
export const SESSION_HOURS = 12;

export interface Session { email: string; shopId: string; exp: number }

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

function key(secret: string) {
  return crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function signSession(s: Session, secret: string) {
  const payload = b64url(enc.encode(JSON.stringify(s)));
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), enc.encode(payload)));
  return `${payload}.${b64url(sig)}`;
}

/** The session if the signature checks out and it hasn't expired. Whether the shop still has that owner is checked by requireOwner. */
export async function verifySession(token: string | undefined, secret: string | undefined): Promise<Session | null> {
  if (!token || !secret) return null;
  const [payload, sig] = token.split(".");
  if (!payload || !sig) return null;
  try {
    const ok = await crypto.subtle.verify("HMAC", await key(secret), fromB64url(sig), enc.encode(payload));
    if (!ok) return null;
    const s = JSON.parse(new TextDecoder().decode(fromB64url(payload))) as Session;
    return typeof s.shopId === "string" && s.exp > Date.now() ? s : null;
  } catch {
    return null;
  }
}
