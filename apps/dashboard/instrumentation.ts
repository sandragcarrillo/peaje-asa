/**
 * On server start, writes the platform's files (Alta sponsor, bridge, providers) into data/ from
 * SEED_DATA, the same way scripts/seed-data.mjs does, so a fresh server works whatever its start
 * command. Files already on disk are never overwritten: the volume keeps what the app wrote.
 * Then, once the server is listening, it starts building the ready demo shops "Try it" hands out.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  (await import("./instrumentation-node")).seedData();
  if (process.env.DEMO_POOL === "off") return;
  setTimeout(() => {
    import("./lib/demo-pool").then((m) => m.ensurePool(m.serverOrigin())).catch((e) => console.error("demo pool:", e));
  }, 15_000);
}
