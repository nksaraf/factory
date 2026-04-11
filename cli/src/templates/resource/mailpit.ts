import type { GeneratedFile } from "../types.js"
import type { ResourceOpts } from "./index.js"

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner } = opts
  return [
    {
      path: "compose/mailpit.yml",
      content: `services:
  infra-mailpit:
    image: axllent/mailpit:latest
    ports:
      - "\${INFRA_MAILPIT_SMTP_PORT:-1025}:1025"
      - "\${INFRA_MAILPIT_UI_PORT:-8025}:8025"
    healthcheck:
      test: ["CMD-SHELL", "wget -q --spider http://localhost:8025/api/v1/info || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
    labels:
      catalog.type: gateway
      catalog.owner: ${owner}
      catalog.description: "Mailpit email testing"
      catalog.port.1025.name: smtp
      catalog.port.1025.protocol: tcp
      catalog.port.8025.name: http
      catalog.port.8025.protocol: http
`,
    },
  ]
}
