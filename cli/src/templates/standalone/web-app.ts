import type { TemplateVars, GeneratedFile } from "../types.js"
import {
  nodeQualityPackageJson,
  nodeQualityFiles,
  nodePrettierConfig,
} from "../quality-configs.js"

export function generate(vars: TemplateVars): GeneratedFile[] {
  const { name } = vars

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
          dev: "vinxi dev --host",
          build: "vinxi build",
          start: "node .output/server/index.mjs",
          ...nodeQualityPackageJson().scripts,
        },
        dependencies: {
          react: "^19.0.0",
          "react-dom": "^19.0.0",
          "react-router": "^7.0.0",
          vinxi: "0.5.11",
          tailwindcss: "^3.4.0",
          postcss: "^8.4.0",
          autoprefixer: "^10.4.0",
        },
        devDependencies: {
          typescript: "^5.9.3",
          "@types/react": "^19.0.0",
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
          target: "ES2020",
          lib: ["ES2020", "DOM", "DOM.Iterable"],
          jsx: "react-jsx",
          module: "ESNext",
          moduleResolution: "bundler",
          esModuleInterop: true,
          strict: true,
          skipLibCheck: true,
          resolveJsonModule: true,
          isolatedModules: true,
          paths: {
            "~/*": ["./*"],
            "@/*": ["./src/*"],
          },
        },
        include: ["src/**/*.ts", "src/**/*.tsx"],
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
      type: "static",
      name: "public",
      dir: "./public",
    },
    {
      type: "spa",
      name: "client",
      handler: "./src/entry.client.tsx",
      target: "browser",
      routes: (router: any, app: any) =>
        new (require("vinxi/fs-router"))({
          dir: "./src/routes",
          extensions: ["page.tsx"],
        }),
    },
    {
      type: "http",
      name: "server",
      handler: "./src/entry.server.tsx",
      target: "server",
    },
  ],
});
`,
  })

  // tailwind.config.cjs
  files.push({
    path: "tailwind.config.cjs",
    content: `/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: ["class"],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,
  })

  // postcss.config.cjs
  files.push({
    path: "postcss.config.cjs",
    content: `module.exports = {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
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
EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
`,
  })

  // src/entry.client.tsx
  files.push({
    path: "src/entry.client.tsx",
    content: `import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router";
import Home from "./routes/index/page";
import "./globals.css";

const root = document.getElementById("root")!;

createRoot(root).render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  </BrowserRouter>,
);
`,
  })

  // src/entry.server.tsx
  files.push({
    path: "src/entry.server.tsx",
    content: `import { renderToString } from "react-dom/server";
import { StaticRouter } from "react-router";
import { defineEventHandler, getRequestURL } from "vinxi/http";
import Home from "./routes/index/page";

export default defineEventHandler(async (event) => {
  const url = getRequestURL(event);

  const html = renderToString(
    <StaticRouter location={url.pathname}>
      <Home />
    </StaticRouter>,
  );

  return new Response(
    \`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
    <link rel="stylesheet" href="/src/globals.css" />
  </head>
  <body>
    <div id="root">\${html}</div>
    <script type="module" src="/src/entry.client.tsx"></script>
  </body>
</html>\`,
    { headers: { "Content-Type": "text/html" } },
  );
});
`,
  })

  // src/globals.css
  files.push({
    path: "src/globals.css",
    content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
  })

  // src/routes/index/page.tsx
  files.push({
    path: "src/routes/index/page.tsx",
    content: `export default function Home() {
  return (
    <main className="flex min-h-screen items-center justify-center">
      <div className="text-center">
        <h1 className="text-4xl font-bold">${name}</h1>
        <p className="mt-4 text-gray-600">Welcome to your new app.</p>
      </div>
    </main>
  );
}
`,
  })

  // Quality tooling configs
  files.push(nodePrettierConfig())
  files.push(...nodeQualityFiles())

  return files
}
