import { defineConfig } from "@hey-api/openapi-ts"

export default defineConfig([
  {
    input: "http://localhost:8005/docs/data/openapi",

    output: "src/client",
    plugins: [
      {
        name: "@tanstack/react-query",
        baseUrl: "http://localhost:9000/api/data",
        queryOptions: true,
        queryKeys: true,
        mutationOptions: true,
      },
    ],
  },
])
