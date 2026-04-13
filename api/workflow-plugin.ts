import { plugin } from "bun"
import { transform } from "@swc/core"

plugin({
  name: "workflow-transform",
  setup(build) {
    build.onLoad({ filter: /\.(ts|tsx|js|jsx)$/ }, async (args) => {
      const source = await Bun.file(args.path).text()
      if (!source.match(/(use step|use workflow)/)) {
        return { contents: source }
      }
      const result = await transform(source, {
        filename: args.path,
        jsc: {
          experimental: {
            plugins: [
              [require.resolve("@workflow/swc-plugin"), { mode: "client" }],
            ],
          },
        },
      })
      return { contents: result.code, loader: "ts" }
    })
  },
})
