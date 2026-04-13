import type { GeneratedFile } from "../types.js"
import type { ResourceOpts } from "./index.js"

export function generate(opts: ResourceOpts): GeneratedFile[] {
  const { owner } = opts
  return [
    {
      path: "compose/minio.yml",
      content: `services:
  infra-minio:
    image: minio/minio:latest
    command: server /data --console-address ":9001"
    ports:
      - "\${INFRA_MINIO_PORT:-9000}:9000"
      - "\${INFRA_MINIO_CONSOLE_PORT:-9001}:9001"
    environment:
      MINIO_ROOT_USER: \${MINIO_ROOT_USER:-minioadmin}
      MINIO_ROOT_PASSWORD: \${MINIO_ROOT_PASSWORD:-minioadmin}
    volumes:
      - minio-data:/data
    healthcheck:
      test: ["CMD", "mc", "ready", "local"]
      interval: 10s
      timeout: 5s
      retries: 5
    labels:
      dx.type: storage
      dx.owner: ${owner}
      dx.description: "MinIO S3-compatible storage"
      dx.port.9000.name: s3
      dx.port.9000.protocol: http
      dx.port.9001.name: console
      dx.port.9001.protocol: http

volumes:
  minio-data:
`,
    },
  ]
}
