# One image for both Railway services (the app and the inference providers); each service picks
# its start command in deploy/railway.*.json. Node 25 like local dev (node:sqlite, metal-pay).
FROM node:25-slim
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json tsconfig.json tsconfig.base.json ./
COPY apps/dashboard/package.json apps/dashboard/
COPY packages/airwallex/package.json packages/airwallex/
COPY packages/ledger/package.json packages/ledger/
COPY packages/metal/package.json packages/metal/
COPY packages/policy/package.json packages/policy/
COPY packages/seller-agent/package.json packages/seller-agent/
COPY packages/storefront/package.json packages/storefront/
COPY packages/treasury-agent/package.json packages/treasury-agent/
COPY providers/package.json providers/
RUN npm ci --include=dev
COPY . .
RUN npx tsc -b && npm run build -w @peaje-asa/dashboard
