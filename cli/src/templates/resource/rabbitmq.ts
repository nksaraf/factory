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
      dx.type: queue
      dx.owner: ${owner}
      dx.description: "RabbitMQ message broker"
      dx.port.5672.name: amqp
      dx.port.5672.protocol: tcp
      dx.port.15672.name: management
      dx.port.15672.protocol: http

volumes:
  rabbitmq-data:
`,
    },
  ]
}
