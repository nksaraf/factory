import type { GeneratedFile } from "../types.js";
import type { ResourceOpts } from "./index.js";

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner, projectName } = opts;
  return [
    {
      path: "compose/auth.yml",
      content: `services:
  infra-auth:
    image: node:22-alpine
    # TODO: Replace with your auth service image
    ports:
      - "\${INFRA_AUTH_PORT:-8180}:3000"
    depends_on:
      infra-postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://\${POSTGRES_USER:-postgres}:\${POSTGRES_PASSWORD:-postgres}@infra-postgres:5432/\${POSTGRES_DB:-${projectName}}
    healthcheck:
      test: ["CMD-SHELL", "node -e \\"fetch('http://localhost:3000/api/v1/auth/ok').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))\\""]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 15s
    labels:
      catalog.type: service
      catalog.owner: ${owner}
      catalog.description: "Authentication service"
      catalog.port.3000.name: http
      catalog.port.3000.protocol: http
`,
    },
    {
      path: "infra/auth/auth.settings.yaml",
      content: `# Auth service configuration
# See https://www.better-auth.com for documentation
`,
    },
  ];
}
