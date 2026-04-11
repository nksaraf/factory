import type { GeneratedFile } from "../types.js"
import type { ResourceOpts } from "./index.js"

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner } = opts
  return [
    {
      path: "compose/rabbitmq.yml",
      content: `services:
  infra-rabbitmq:
    image: rabbitmq:4-management-alpine
    ports:
      - "\${INFRA_RABBITMQ_PORT:-5672}:5672"
      - "\${INFRA_RABBITMQ_MGMT_PORT:-15672}:15672"
    environment:
      RABBITMQ_DEFAULT_USER: \${RABBITMQ_USER:-guest}
      RABBITMQ_DEFAULT_PASS: \${RABBITMQ_PASSWORD:-guest}
    volumes:
      - rabbitmq-data:/var/lib/rabbitmq
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    labels:
      catalog.type: queue
      catalog.owner: ${owner}
      catalog.description: "RabbitMQ message broker"
      catalog.port.5672.name: amqp
      catalog.port.5672.protocol: tcp
      catalog.port.15672.name: management
      catalog.port.15672.protocol: http

volumes:
  rabbitmq-data:
`,
    },
  ]
}
