/** The dashboard reads the repo's root .env and the shared SQLite book, like the chat and the scripts. */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const root = resolve(process.cwd(), "../..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
process.env.DB_PATH ??= resolve(root, "data/peaje-asa.db");
