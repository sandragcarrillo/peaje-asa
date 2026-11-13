/**
 * Writes the platform's files into data/ on a fresh server (Railway): SEED_DATA is base64 of a
 * gzipped JSON map { "data/metal/sponsor.json": "<file contents>", ... }, made locally with
 * `node scripts/pack-seed.mjs`. Files already on disk are never overwritten, so a volume keeps
 * what the app wrote after the first boot.
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";

const seed = process.env.SEED_DATA;
if (!seed) process.exit(0);
const root = resolve(import.meta.dirname, "..");
const files = JSON.parse(gunzipSync(Buffer.from(seed, "base64")).toString("utf8"));
let wrote = 0;
for (const [rel, body] of Object.entries(files)) {
  if (!rel.startsWith("data/") || rel.includes("..")) throw new Error(`seed path outside data/: ${rel}`);
  const path = resolve(root, rel);
  if (existsSync(path)) continue;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, body, { mode: 0o600 });
  wrote++;
}
console.log(`seed: wrote ${wrote} of ${Object.keys(files).length} file(s)`);
