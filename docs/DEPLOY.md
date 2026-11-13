# Deploy (Railway)

Two services from this repo, one image (`Dockerfile`):

| Service | Config file | Public | What it runs |
|---|---|---|---|
| `app` | `deploy/railway.app.json` | yes, `asa.usepeaje.com` | the dashboard, shop chats, the buyer agents' storefront (checkout, OAuth, Airwallex webhook) |
| `providers` | `deploy/railway.providers.json` | no | the three inference providers on ports 4101-4103, reached over Railway's private network |

Name the second service exactly `providers`: the app's variables reference it.

## Steps

1. New project > Deploy from GitHub repo > this repo. Rename the service to `app`.
2. `app` > Settings > Config-as-code: `deploy/railway.app.json`.
3. `app` > Volume: mount at `/app/data` (SQLite book, each shop's Metal keys, the OAuth signing key, webhook log).
4. New service > same repo, named `providers`. Settings > Config-as-code: `deploy/railway.providers.json`. No domain.
5. Variables (below), then deploy both.
6. `app` > Settings > Networking > Custom domain `asa.usepeaje.com`. Railway shows a CNAME target: add it in Cloudflare (DNS > `asa` CNAME to that target, proxy off).
7. Locally, with `PUBLIC_URL=https://asa.usepeaje.com`: `npm run kit10 -- setup` and `npm run kit10 -- products` (they talk to Airwallex, not to Railway; products need the shops, so run `products` once the shops exist on the deployed book).
8. Airwallex web app > Developer > Webhooks: `payment_intent.succeeded` to `https://asa.usepeaje.com/api/airwallex/webhook`; put its secret in `app` as `AWX_WEBHOOK_SECRET`.

## Variables

`SEED_DATA` carries the platform's Metal files (gas sponsor, bridge, provider addresses) to a fresh disk. Make it with `node scripts/pack-seed.mjs <file>` and paste the file's contents; it is written at boot only where no file exists yet.

`app`:

| Variable | Value |
|---|---|
| `AWX_CLIENT_ID`, `AWX_API_KEY`, `AWX_BASE_URL` | as in `.env` |
| `METAL_RPC_URL` | as in `.env` |
| `ORDER_SIGNING_KEY` | as in `.env` |
| `SESSION_SECRET` | a new random value (`openssl rand -hex 32`) |
| `OWNER_EMAIL`, `OWNER_PASSWORD_HASH` | optional: seeds the demo shop's owner (`npm run keys:owner`) |
| `PUBLIC_URL` | `https://asa.usepeaje.com` |
| `AGENTIC_CHECKOUT_SECRET` | as in `.env` (must match what `kit10 setup` registered) |
| `AWX_WEBHOOK_SECRET` | from step 8 |
| `PROVIDER_CHEAP_URL` | `http://${{providers.RAILWAY_PRIVATE_DOMAIN}}:4101` |
| `PROVIDER_MID_URL` | `http://${{providers.RAILWAY_PRIVATE_DOMAIN}}:4102` |
| `PROVIDER_PREMIUM_URL` | `http://${{providers.RAILWAY_PRIVATE_DOMAIN}}:4103` |
| `SEED_DATA` | from `pack-seed` |

`providers`:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | as in `.env` |
| `SEED_DATA` | same value as the app |
