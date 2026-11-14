/**
 * On server start, writes the platform's files (Metal sponsor, bridge, providers) into data/ from
 * SEED_DATA, the same way scripts/seed-data.mjs does, so a fresh server works whatever its start
 * command. Files already on disk are never overwritten: the volume keeps what the app wrote.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") (await import("./instrumentation-node")).seedData();
}
