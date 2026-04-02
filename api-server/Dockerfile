# Build from monorepo root (see docker-compose.yaml api.build.context).
# Example: docker build -f api-server/Dockerfile .
#
# Uses Bun directly (not Nitro) so Elysia WebSocket handlers work natively.

# Build from monorepo root (see docker-compose.yaml api.build.context).
# Example: docker build -f factory/api/Dockerfile .

FROM node:22-alpine AS builder

ARG GOOGLE_APPLICATION_CREDENTIALS_BASE64
ENV GOOGLE_APPLICATION_CREDENTIALS_BASE64=${GOOGLE_APPLICATION_CREDENTIALS_BASE64}

RUN apk add --no-cache python3 build-base

RUN corepack enable && corepack prepare pnpm@latest --activate



WORKDIR /repo

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY .npmrc* ./

COPY ./api/package.json ./api/
COPY ./api-server/package.json ./api-server/
COPY ./shared/package.json ./shared/

RUN npx get-artifactregistry-token@3.4.2

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY ./api ./api
COPY ./api-server ./api-server
COPY ./shared ./shared
# Migrations: generate in api (`pnpm --filter @smp/factory-api run db:generate`).
COPY ./api/drizzle ./drizzle


FROM oven/bun:1-alpine AS runner

RUN apk add --no-cache nodejs

WORKDIR /app

# Copy the full workspace (Bun runs TypeScript directly, no build step needed)
COPY --from=builder /repo /app

ENV NODE_ENV=production
ENV PORT=4100
EXPOSE 4100 9090

CMD ["bun", "run", "api-server/src/bun-entry.ts"]
