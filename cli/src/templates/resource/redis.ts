import type { GeneratedFile } from "../types.js"
import type { ResourceOpts } from "./index.js"

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner } = opts
  return [
    {
      path: "compose/redis.yml",
      content: `services:
  infra-redis:
    image: redis:7-alpine
    ports:
      - "\${INFRA_REDIS_PORT:-6379}:6379"
    volumes:
      - redis-data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    labels:
      dx.type: cache
      dx.owner: ${owner}
      dx.description: "Redis cache"
      dx.port.6379.name: redis
      dx.port.6379.protocol: tcp

volumes:
  redis-data:
`,
    },
  ]
}
