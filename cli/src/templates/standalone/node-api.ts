import type { TemplateVars, GeneratedFile } from "../types.js"
import {
  componentLabels,
  resourceLabels,
  labelsToYaml,
} from "../compose-labels.js"
import {
  nodeQualityPackageJson,
  nodeQualityFiles,
  nodePrettierConfig,
} from "../quality-configs.js"

export function generate(vars: TemplateVars): GeneratedFile[] {
  const { name, owner, description } = vars

  const files: GeneratedFile[] = []

  // package.json
  files.push({
    path: "package.json",
    content: JSON.stringify(
      {
        name,
        version: "0.0.1",
        private: true,
        type: "module",
        scripts: {
          dev: "vinxi dev --port 3000",
          build: "vinxi build",
          start: "node .output/server/index.mjs",
          "db:generate": "drizzle-kit generate",
          "db:migrate": "drizzle-kit migrate",
          "db:push": "drizzle-kit push",
          ...nodeQualityPackageJson().scripts,
        },
        dependencies: {
          "@elysiajs/cors": "^1.4.1",
          "@elysiajs/node": "^1.4.5",
          "drizzle-orm": "^0.45.1",
          elysia: "^1.4.27",
          jose: "^6.2.2",
          pg: "^8.20.0",
          vinxi: "0.5.11",
          zod: "^3.23.8",
        },
        devDependencies: {
          "drizzle-kit": "^0.31.9",
          typescript: "^5.9.3",
          ...nodeQualityPackageJson().devDependencies,
        },
        "simple-git-hooks": nodeQualityPackageJson()["simple-git-hooks"],
        "lint-staged": nodeQualityPackageJson()["lint-staged"],
      },
      null,
      2
    ),
  })

  // tsconfig.json
  files.push({
    path: "tsconfig.json",
    content: JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "ESNext",
          moduleResolution: "bundler",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          outDir: "./dist",
          resolveJsonModule: true,
          isolatedModules: true,
          declaration: true,
          sourceMap: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2
    ),
  })

  // app.config.ts
  files.push({
    path: "app.config.ts",
    content: `import { createApp } from "vinxi";

export default createApp({
  routers: [
    {
      type: "http",
      handler: "./src/handler.ts",
      target: "server",
      name: "server",
    },
  ],
});
`,
  })

  // drizzle.config.ts
  files.push({
    path: "drizzle.config.ts",
    content: `import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres",
  },
});
`,
  })

  // Dockerfile
  files.push({
    path: "Dockerfile",
    content: `FROM node:22-alpine AS builder

RUN corepack enable && corepack prepare pnpm@latest --activate

WORKDIR /app

COPY package.json pnpm-lock.yaml* ./
RUN --mount=type=cache,id=pnpm,target=/pnpm/store pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

FROM node:22-alpine AS runner

WORKDIR /app

COPY --from=builder /app/.output ./.output

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
`,
  })

  // docker-compose.yaml
  const svcLabels = componentLabels({
    type: "service",
    owner,
    description,
    runtime: "node",
    port: { number: 3000, name: "http", protocol: "tcp" },
  })

  const pgLabels = resourceLabels({
    type: "database",
    owner,
    description: `PostgreSQL database for ${name}`,
    port: { number: 5432, name: "postgresql", protocol: "tcp" },
  })

  files.push({
    path: "docker-compose.yaml",
    content: `services:
  ${name}:
    build: .
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:postgres@${name}-postgres:5432/postgres
      AUTH_JWKS_URL: \${AUTH_JWKS_URL:-}
    depends_on:
      ${name}-postgres:
        condition: service_healthy
    labels:
${labelsToYaml(svcLabels, 6)}

  ${name}-postgres:
    image: postgres:16-alpine
    ports:
      - "5432:5432"
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: postgres
    volumes:
      - ${name}-pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 5s
      retries: 5
    labels:
${labelsToYaml(pgLabels, 6)}

volumes:
  ${name}-pgdata:
`,
  })

  // src/handler.ts
  files.push({
    path: "src/handler.ts",
    content: `import { defineEventHandler, toWebRequest } from "vinxi/http";

import { createServer } from "./server";

const appPromise = createServer();

export default defineEventHandler(async (event) => {
  const app = await appPromise;
  const request = toWebRequest(event);
  return app.fetch(request);
});
`,
  })

  // src/server.ts
  files.push({
    path: "src/server.ts",
    content: `import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { node } from "@elysiajs/node";

import { healthRoutes } from "./health";

export async function createServer() {
  const app = new Elysia({ adapter: node() })
    .use(cors())
    .use(healthRoutes)
    .get("/", () => ({ name: "${name}", status: "running" }));

  return app;
}

export type Server = Awaited<ReturnType<typeof createServer>>;
`,
  })

  // src/health.ts
  files.push({
    path: "src/health.ts",
    content: `import { Elysia } from "elysia";

export const healthRoutes = new Elysia().get("/health", () => ({
  status: "ok",
}));
`,
  })

  // src/plugins/auth.plugin.ts
  files.push({
    path: "src/plugins/auth.plugin.ts",
    content: `import { Elysia } from "elysia";
import { jwtVerify, createRemoteJWKSet } from "jose";

const JWKS_URL = process.env.AUTH_JWKS_URL;

const jwks = JWKS_URL ? createRemoteJWKSet(new URL(JWKS_URL)) : null;

export const authPlugin = new Elysia({ name: "auth" }).derive(
  async ({ headers }) => {
    const authorization = headers["authorization"];
    if (!authorization?.startsWith("Bearer ")) {
      return { user: null };
    }

    const token = authorization.slice(7);

    if (!jwks) {
      return { user: null };
    }

    try {
      const { payload } = await jwtVerify(token, jwks);
      return { user: payload };
    } catch {
      return { user: null };
    }
  },
);
`,
  })

  // src/db/connection.ts
  files.push({
    path: "src/db/connection.ts",
    content: `import { drizzle } from "drizzle-orm/node-postgres";

import * as schema from "./schema/index";

export const db = drizzle(
  process.env.DATABASE_URL ?? "postgresql://postgres:postgres@localhost:5432/postgres",
  { schema },
);

export type Database = typeof db;
`,
  })

  // src/db/schema/index.ts
  files.push({
    path: "src/db/schema/index.ts",
    content: `// Add your Drizzle schema definitions here and export them.
`,
  })

  // Quality tooling configs
  files.push(nodePrettierConfig())
  files.push(...nodeQualityFiles())

  return files
}
