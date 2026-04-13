import type { GeneratedFile } from "../types.js"
import type { ResourceOpts } from "./index.js"

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner } = opts
  return [
    {
      path: "compose/gateway.yml",
      content: `services:
  infra-gateway:
    image: apache/apisix:3.11.0-debian
    ports:
      - "\${INFRA_GATEWAY_PORT:-9080}:9080"
    volumes:
      - ./infra/apisix/config.yaml:/usr/local/apisix/conf/config.yaml:ro
    healthcheck:
      test: ["CMD-SHELL", "curl -sf http://localhost:9080/apisix/status || exit 1"]
      interval: 10s
      timeout: 5s
      retries: 5
    labels:
      dx.type: service
      dx.owner: ${owner}
      dx.description: "API gateway"
      dx.port.9080.name: http
      dx.port.9080.protocol: http
`,
    },
    {
      path: "infra/apisix/config.yaml",
      content: `deployment:
  role: data_plane
  role_data_plane:
    config_provider: yaml

apisix:
  node_listen: 9080

routes: []
`,
    },
  ]
}
