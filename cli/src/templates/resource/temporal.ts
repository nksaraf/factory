import type { GeneratedFile } from "../types.js";
import type { ResourceOpts } from "./index.js";

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner, projectName } = opts;
  return [
    {
      path: "compose/temporal.yml",
      content: `services:
  infra-temporal:
    image: temporalio/auto-setup:latest
    ports:
      - "\${INFRA_TEMPORAL_PORT:-7233}:7233"
    environment:
      DB: postgres12
      DB_PORT: 5432
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PWD: \${POSTGRES_PASSWORD:-postgres}
      POSTGRES_SEEDS: infra-postgres
      DYNAMIC_CONFIG_FILE_PATH: config/dynamicconfig/development.yaml
    depends_on:
      infra-postgres:
        condition: service_healthy
    healthcheck:
      test: ["CMD", "tctl", "--address", "localhost:7233", "cluster", "health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    labels:
      catalog.type: queue
      catalog.owner: ${owner}
      catalog.description: "Temporal workflow engine"
      catalog.port.7233.name: grpc
      catalog.port.7233.protocol: grpc

  infra-temporal-ui:
    image: temporalio/ui:latest
    ports:
      - "\${INFRA_TEMPORAL_UI_PORT:-8233}:8080"
    environment:
      TEMPORAL_ADDRESS: infra-temporal:7233
      TEMPORAL_CORS_ORIGINS: http://localhost:8233
    depends_on:
      infra-temporal:
        condition: service_healthy
    labels:
      catalog.type: queue
      catalog.owner: ${owner}
      catalog.description: "Temporal Web UI"
      catalog.port.8080.name: http
      catalog.port.8080.protocol: http
`,
    },
  ];
}
