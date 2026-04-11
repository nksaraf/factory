import type { GeneratedFile } from "../types.js"
import type { ResourceOpts } from "./index.js"

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner, projectName } = opts
  return [
    {
      path: "compose/postgres.yml",
      content: `services:
  infra-postgres:
    image: postgres:16-alpine
    ports:
      - "\${INFRA_POSTGRES_PORT:-5432}:5432"
    environment:
      POSTGRES_USER: \${POSTGRES_USER:-postgres}
      POSTGRES_PASSWORD: \${POSTGRES_PASSWORD:-postgres}
      POSTGRES_DB: \${POSTGRES_DB:-${projectName}}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 5s
      timeout: 3s
      retries: 5
    labels:
      catalog.type: database
      catalog.owner: ${owner}
      catalog.description: "PostgreSQL database"
      catalog.port.5432.name: postgres
      catalog.port.5432.protocol: tcp

volumes:
  postgres-data:
`,
    },
  ]
}
