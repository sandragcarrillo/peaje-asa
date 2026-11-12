/**
 * The OAuth server a buyer's Claude signs in through before it calls the platform's merchant
 * MCP on Airwallex (Kit 10, ACP). Authorization code with PKCE (S256), dynamic client
 * registration, and access tokens as ES256 JWTs that Airwallex checks against our JWKS.
 *
 * Shoppers sign in as guests with an email: we hold no Airwallex customer id for them, so the
 * token carries no `awx_customer_id` and Airwallex treats them as guests (no saved cards).
 */
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, randomBytes, sign, type JsonWebKey, type KeyObject } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { defaultDbPath, openDatabase } from "@peaje-asa/ledger";

const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const token = (bytes = 24) => randomBytes(bytes).toString("base64url");
const nowS = () => Math.floor(Date.now() / 1000);

export const ACCESS_TTL_S = 3600;
const CODE_TTL_S = 300;
const REFRESH_TTL_S = 30 * 24 * 3600;

/** The signing key, made once and kept in a file (mode 0600). Only its public half is published. */
export class OAuthKey {
  private constructor(private key: KeyObject, readonly kid: string) {}
  static load(path: string) {
    if (!existsSync(path)) {
      mkdirSync(dirname(path), { recursive: true });
      const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
      writeFileSync(path, JSON.stringify(privateKey.export({ format: "jwk" })), { mode: 0o600 });
    }
    const jwk = JSON.parse(readFileSync(path, "utf8")) as JsonWebKey;
    const key = createPrivateKey({ key: jwk, format: "jwk" });
    const pub = createPublicKey(key).export({ format: "jwk" }) as JsonWebKey;
    // RFC 7638 thumbprint as the key id.
    const kid = b64url(createHash("sha256").update(JSON.stringify({ crv: pub.crv, kty: pub.kty, x: pub.x, y: pub.y })).digest());
    return new OAuthKey(key, kid);
  }
  jwks() {
    const pub = createPublicKey(this.key).export({ format: "jwk" }) as JsonWebKey;
    return { keys: [{ kty: pub.kty, crv: pub.crv, x: pub.x, y: pub.y, kid: this.kid, alg: "ES256", use: "sig" }] };
  }
  jwt(claims: Record<string, unknown>) {
    const head = b64url(JSON.stringify({ alg: "ES256", typ: "JWT", kid: this.kid }));
    const body = b64url(JSON.stringify(claims));
    const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key: this.key, dsaEncoding: "ieee-p1363" });
    return `${head}.${body}.${b64url(sig)}`;
  }
}

/** Authorization server metadata (RFC 8414), also served as OIDC discovery. `issuer` is the base URL. */
export function oauthMetadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    jwks_uri: `${issuer}/oauth/jwks.json`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: ["openid", "email"],
    subject_types_supported: ["public"],
    id_token_signing_alg_values_supported: ["ES256"],
  };
}

export class OAuthError extends Error {
  constructor(readonly error: string, readonly description: string, readonly status = 400) { super(`${error}: ${description}`); }
  body() { return { error: this.error, error_description: this.description }; }
}

export interface AuthorizeRequest {
  client_id: string; redirect_uri: string; response_type: string; code_challenge: string; code_challenge_method: string; state?: string; scope?: string;
}

/** Clients, codes and refresh tokens, in the shared SQLite file. Codes and refresh tokens are stored hashed. */
export class OAuthServer {
  private db;
  constructor(readonly issuer: string, private key: OAuthKey, path = defaultDbPath()) {
    this.db = openDatabase(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS oauth_clients (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_codes (hash TEXT PRIMARY KEY, body TEXT NOT NULL, expires INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS oauth_refresh (hash TEXT PRIMARY KEY, body TEXT NOT NULL, expires INTEGER NOT NULL);
    `);
  }

  private static hash = (s: string) => createHash("sha256").update(s).digest("hex");

  /** Dynamic client registration (RFC 7591): public clients only, redirect URIs must be https or loopback. */
  register(input: { redirect_uris?: unknown; client_name?: unknown }) {
    const uris = Array.isArray(input.redirect_uris) ? input.redirect_uris.filter((u): u is string => typeof u === "string") : [];
    if (uris.length === 0) throw new OAuthError("invalid_redirect_uri", "redirect_uris is required");
    for (const u of uris) {
      let url: URL;
      try { url = new URL(u); } catch { throw new OAuthError("invalid_redirect_uri", `not a URL: ${u}`); }
      const loopback = url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (url.protocol !== "https:" && !loopback) throw new OAuthError("invalid_redirect_uri", `redirect URIs must be https or loopback: ${u}`);
    }
    const client = {
      client_id: `cl_${token(12)}`, client_name: typeof input.client_name === "string" ? input.client_name.slice(0, 100) : "Buyer agent",
      redirect_uris: uris, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
      client_id_issued_at: nowS(),
    };
    this.db.prepare("INSERT INTO oauth_clients (id, body, created_at) VALUES (?, ?, ?)").run(client.client_id, JSON.stringify(client), new Date().toISOString());
    return client;
  }

  client(id: string): { client_id: string; client_name: string; redirect_uris: string[] } | undefined {
    const row = this.db.prepare("SELECT body FROM oauth_clients WHERE id = ?").get(id) as { body: string } | undefined;
    return row && JSON.parse(row.body);
  }

  /** Checks an authorization request before showing the sign-in page. Errors here must not redirect. */
  check(req: AuthorizeRequest) {
    const client = this.client(req.client_id);
    if (!client) throw new OAuthError("invalid_client", "unknown client_id");
    if (!client.redirect_uris.includes(req.redirect_uri)) throw new OAuthError("invalid_request", "redirect_uri is not registered for this client");
    if (req.response_type !== "code") throw new OAuthError("unsupported_response_type", "only code is supported");
    if (req.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(req.code_challenge ?? "")) throw new OAuthError("invalid_request", "PKCE with S256 is required");
    return client;
  }

  /** The shopper signed in: returns where to send the browser, with a one-time code. */
  approve(req: AuthorizeRequest, email: string) {
    this.check(req);
    const clean = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean) || clean.length > 200) throw new OAuthError("invalid_request", "a valid email is required");
    const code = token();
    const body = { client_id: req.client_id, redirect_uri: req.redirect_uri, code_challenge: req.code_challenge, email: clean, scope: req.scope ?? "openid email" };
    this.db.prepare("INSERT INTO oauth_codes (hash, body, expires) VALUES (?, ?, ?)").run(OAuthServer.hash(code), JSON.stringify(body), nowS() + CODE_TTL_S);
    const to = new URL(req.redirect_uri);
    to.searchParams.set("code", code);
    if (req.state) to.searchParams.set("state", req.state);
    return to.toString();
  }

  /** The token endpoint: an authorization code (once, with its PKCE verifier) or a refresh token (rotated). */
  exchange(form: Record<string, string | undefined>) {
    if (form.grant_type === "authorization_code") {
      const h = OAuthServer.hash(form.code ?? "");
      const row = this.db.prepare("DELETE FROM oauth_codes WHERE hash = ? RETURNING body, expires").get(h) as { body: string; expires: number } | undefined;
      if (!row || row.expires < nowS()) throw new OAuthError("invalid_grant", "the code is unknown, used or expired");
      const c = JSON.parse(row.body) as { client_id: string; redirect_uri: string; code_challenge: string; email: string; scope: string };
      if (form.client_id && form.client_id !== c.client_id) throw new OAuthError("invalid_grant", "the code was issued to another client");
      if (form.redirect_uri !== c.redirect_uri) throw new OAuthError("invalid_grant", "redirect_uri does not match");
      const challenge = createHash("sha256").update(form.code_verifier ?? "").digest("base64url");
      if (challenge !== c.code_challenge) throw new OAuthError("invalid_grant", "the PKCE verifier does not match");
      return this.issue(c.client_id, c.email, c.scope);
    }
    if (form.grant_type === "refresh_token") {
      const h = OAuthServer.hash(form.refresh_token ?? "");
      const row = this.db.prepare("DELETE FROM oauth_refresh WHERE hash = ? RETURNING body, expires").get(h) as { body: string; expires: number } | undefined;
      if (!row || row.expires < nowS()) throw new OAuthError("invalid_grant", "the refresh token is unknown, used or expired");
      const r = JSON.parse(row.body) as { client_id: string; email: string; scope: string };
      if (form.client_id && form.client_id !== r.client_id) throw new OAuthError("invalid_grant", "the refresh token was issued to another client");
      return this.issue(r.client_id, r.email, r.scope);
    }
    throw new OAuthError("unsupported_grant_type", "use authorization_code or refresh_token");
  }

  private issue(clientId: string, email: string, scope: string) {
    const iat = nowS();
    const sub = `guest_${createHash("sha256").update(email).digest("hex").slice(0, 24)}`;
    const claims = { iss: this.issuer, sub, aud: clientId, client_id: clientId, email, scope, iat, exp: iat + ACCESS_TTL_S, jti: token(12) };
    const refresh = token(32);
    this.db.prepare("INSERT INTO oauth_refresh (hash, body, expires) VALUES (?, ?, ?)").run(OAuthServer.hash(refresh), JSON.stringify({ client_id: clientId, email, scope }), iat + REFRESH_TTL_S);
    const out: Record<string, unknown> = { access_token: this.key.jwt(claims), token_type: "Bearer", expires_in: ACCESS_TTL_S, refresh_token: refresh, scope };
    if (scope.split(" ").includes("openid")) out.id_token = this.key.jwt({ iss: this.issuer, sub, aud: clientId, email, iat, exp: iat + ACCESS_TTL_S });
    return out;
  }
}
