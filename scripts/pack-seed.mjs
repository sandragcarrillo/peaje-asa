/**
 * Packs the platform's Metal files (gas sponsor, bridge, provider addresses) into one value for
 * the SEED_DATA variable on Railway. Writes it to the file given (mode 0600); never prints it.
 *   node scripts/pack-seed.mjs /path/to/seed.txt
 */
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";

const out = process.argv[2];
if (!out) throw new Error("usage: node scripts/pack-seed.mjs <output file>");
const paths = ["data/metal/sponsor.json", "data/metal/bridge.json", "data/metal/providers.json"];
const files = Object.fromEntries(paths.map((p) => [p, readFileSync(p, "utf8")]));
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(files))).toString("base64"), { mode: 0o600 });
console.log(`packed ${paths.length} files into ${out}`);
