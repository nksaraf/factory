# Build from monorepo root (see factory/dx.yaml api.build.context).
# Example: docker build -f factory/api/Dockerfile .

FROM node:22-alpine AS builder

RUN apk add --no-cache python3 build-base

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .npmrc* ./

COPY factory/api/package.json ./factory/api/
COPY factory/shared/package.json ./factory/shared/
COPY packages/npm/app-config/package.json ./packages/npm/app-config/

RUN npx get-artifactregistry-token@3.4.2

RUN pnpm install --frozen-lockfile --filter @smp/factory-api...

COPY factory/api ./factory/api
COPY factory/shared ./factory/shared
COPY packages/npm/app-config ./packages/npm/app-config

RUN pnpm --filter @rio.js/app-config build
RUN pnpm --filter @smp/factory-api build

FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder /repo/factory/api/.output .

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", "server/index.mjs"]
