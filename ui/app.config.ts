import mdx from "@mdx-js/rollup"
import { fileURLToPath } from "node:url"
import rehypePrettyCode from "rehype-pretty-code"
import remarkGfm from "remark-gfm"
import { config } from "vinxi/plugins/config"

import { createApp, loadEnv, routers } from "@rio.js/vinxi"

import { envSchema } from "./app.settings"

loadEnv(envSchema, import.meta.url)

const app = createApp({
  server: {
    compressPublicAssets: true,
    preset: process.env.SERVER_TARGET ?? "node-server",
    prerender: {
      routes: ["/"],
    },
    host: true,
    plugins: [fileURLToPath(new URL("./src/logger.ts", import.meta.url))],
    rollupConfig: {
      external: ["gdal-async"],
    },
  },
  routers: [
    routers.public(),
    routers.api({
      dir: "./src/routes/api",
      plugins: () => [
        config("aliases", {
          resolve: {
            alias: {
              "@": fileURLToPath(new URL("./src", import.meta.url)),
              "~": fileURLToPath(new URL(".", import.meta.url)),
            },
          },
        }),
      ],
    }),
    routers.reactClient({
      plugins: () => [
        config("aliases", {
          resolve: {
            alias: {
              "@/components/ui": "@rio.js/ui/components",
              "@": fileURLToPath(new URL("./src", import.meta.url)),
              "~": fileURLToPath(new URL(".", import.meta.url)),
            },
          },
        }),
        mdx({
          providerImportSource: "@mdx-js/react",
          remarkPlugins: [remarkGfm],
          rehypePlugins: [
            [
              rehypePrettyCode,
              {
                theme: "github-dark-default",
                keepBackground: true,
              },
            ],
          ],
        }),
      ],
      tailwindcss: false,
      handler: "./src/entry.client.tsx",
      routesDir: "./src/routes",
      fonts: {
        custom: {
          families: [
            {
              name: "Custom",
              src: "./public/fonts/circular/Custom*",
            },
          ],
        },
      },
    }),
    routers.reactServer({
      handler: "./src/entry.server.tsx",
      middleware: "./src/middleware.ts",
    }),
    routers.serverFn(),
  ],
})

export default app
