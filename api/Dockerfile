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
COPY ./shared/package.json ./shared/

RUN npx get-artifactregistry-token@3.4.2

RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile


COPY ./api ./api
COPY ./shared ./shared

RUN pnpm --filter @smp/factory-api build

FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder /repo/api/.output ./.output
COPY --from=builder /repo/api/drizzle ./drizzle

ENV NODE_ENV=production
ENV PORT=4100
EXPOSE 4100

CMD ["node", ".output/server/index.mjs"]
