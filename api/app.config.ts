import "dotenv/config"

import { fileURLToPath } from "node:url"
import { config } from "vinxi/plugins/config"

import { createApp } from "@rio.js/vinxi"

export default createApp({
  server: {
    routeRules: {
      "/**": {
        headers: {
          "Access-Control-Allow-Credentials": "true",
        },
      },
    },
    plugins: [
      fileURLToPath(new URL("./src/init.js", import.meta.url)),
      fileURLToPath(new URL("./src/logger.ts", import.meta.url)),
    ],
  },
  routers: [
    {
      type: "http",
      handler: "./src/handler.ts",
      target: "server",
      name: "server",
      plugins: () => [
        config("env variables", {
          envPrefix: "PRIVATE_",
        }),
      ],
    },
  ],
})
