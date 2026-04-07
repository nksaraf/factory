/** Parse a TTL string like "24h", "7d", "30m" into milliseconds. */
export function parseTtlToMs(ttl: string): number {
  const match = ttl.match(/^(\d+)(h|d|m)$/);
  if (!match) throw new Error(`Invalid TTL format: ${ttl}`);
  const [, value, unit] = match;
  const multipliers = { m: 60_000, h: 3_600_000, d: 86_400_000 };
  return parseInt(value!) * multipliers[unit as keyof typeof multipliers];
}

/** Standard dependency container templates. */
export const STANDARD_DEPENDENCIES: Record<
  string,
  { name: string; image: string; port: number; env: Record<string, string> }
> = {
  postgres: {
    name: "postgres",
    image: "postgres:16-alpine",
    port: 5432,
    env: { POSTGRES_DB: "app", POSTGRES_USER: "app", POSTGRES_PASSWORD: "dev" },
  },
  redis: {
    name: "redis",
    image: "redis:7-alpine",
    port: 6379,
    env: {},
  },
  minio: {
    name: "minio",
    image: "minio/minio:latest",
    port: 9000,
    env: { MINIO_ROOT_USER: "minioadmin", MINIO_ROOT_PASSWORD: "minioadmin" },
  },
};
