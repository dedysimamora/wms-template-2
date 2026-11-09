# syntax=docker/dockerfile:1.7
# Artefak rilis: dua target dari satu basis kode.
#   web     — Next.js standalone (server.js), brand dipilih saat build:  --build-arg BRAND_ID=<klien>
#   migrate — CLI db (migrate + seed, forward-only & idempoten) — dijalankan sekali tiap deploy.
# Bangun:  docker build --target web     -t wms-web:<versi>     --build-arg BRAND_ID=default .
#          docker build --target migrate -t wms-migrate:<versi> .
ARG NODE_VERSION=22.15.0

FROM node:${NODE_VERSION}-bookworm-slim AS base
ENV PNPM_HOME=/pnpm NEXT_TELEMETRY_DISABLED=1
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /repo

# Dependensi (lapisan ter-cache selama lockfile tak berubah)
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm fetch
COPY . .
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile --offline

# ── web ──────────────────────────────────────────────────────────────────────
FROM deps AS web-build
ARG BRAND_ID=default
ENV BRAND_ID=$BRAND_ID NODE_ENV=production
RUN pnpm --filter @wms/web build

FROM node:${NODE_VERSION}-bookworm-slim AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app
COPY --from=web-build --chown=node:node /repo/apps/web/.next/standalone ./
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "apps/web/server.js"]

# ── migrate (CLI db) ─────────────────────────────────────────────────────────
FROM deps AS migrate
ENV NODE_ENV=production
RUN chown -R node:node /repo
USER node
CMD ["sh", "-c", "pnpm db:migrate && pnpm db:seed"]
