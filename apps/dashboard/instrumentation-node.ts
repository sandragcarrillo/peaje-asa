/** The Node half of instrumentation.ts: the seed, kept apart so the edge build never sees node: modules. */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { gunzipSync } from "node:zlib";
import { root } from "./lib/env";

export function seedData() {
  const seed = process.env.SEED_DATA;
  if (!seed) {
    if (!existsSync(resolve(root, "data/metal/bridge.json"))) console.warn("seed: SEED_DATA is not set and data/metal/bridge.json is missing; Metal payments will fail");
    return;
  }
  try {
    const files = JSON.parse(gunzipSync(Buffer.from(seed, "base64")).toString("utf8")) as Record<string, string>;
    let wrote = 0;
    for (const [rel, body] of Object.entries(files)) {
      if (!rel.startsWith("data/") || rel.includes("..")) throw new Error(`path outside data/: ${rel}`);
      const path = resolve(root, rel);
      if (existsSync(path)) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body, { mode: 0o600 });
      wrote++;
    }
    console.log(`seed: wrote ${wrote} of ${Object.keys(files).length} file(s)`);
  } catch (e) {
    console.error(`seed: SEED_DATA could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}
