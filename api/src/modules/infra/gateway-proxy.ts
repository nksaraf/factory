import { LRUCache } from "lru-cache";

export type RouteFamily = "tunnel" | "preview" | "sandbox";

export interface ParsedHost {
  family: RouteFamily;
  slug: string;
}

const FAMILY_SUFFIXES: { suffix: string; family: RouteFamily }[] = [
  { suffix: ".tunnel.dx.dev", family: "tunnel" },
  { suffix: ".preview.dx.dev", family: "preview" },
  { suffix: ".sandbox.dx.dev", family: "sandbox" },
];

export function parseHostname(host: string | undefined): ParsedHost | null {
  if (!host) return null;

  // Strip port if present
  const hostname = host.split(":")[0];

  for (const { suffix, family } of FAMILY_SUFFIXES) {
    if (hostname.endsWith(suffix)) {
      const slug = hostname.slice(0, -suffix.length);
      if (slug.length > 0) {
        return { family, slug };
      }
    }
  }

  return null;
}

export interface RouteCacheOptions {
  lookup: (domain: string) => Promise<any | null>;
  maxSize?: number;
  ttlMs?: number;
}

const SENTINEL_NULL = Symbol("null");

export class RouteCache {
  private cache: LRUCache<string, any>;
  private lookup: (domain: string) => Promise<any | null>;

  constructor(opts: RouteCacheOptions) {
    this.lookup = opts.lookup;
    this.cache = new LRUCache<string, any>({
      max: opts.maxSize ?? 10_000,
      ttl: opts.ttlMs ?? 300_000, // 5 min default
    });
  }

  async get(domain: string): Promise<any | null> {
    const cached = this.cache.get(domain);
    if (cached !== undefined) {
      return cached === SENTINEL_NULL ? null : cached;
    }

    const result = await this.lookup(domain);
    this.cache.set(domain, result ?? SENTINEL_NULL);
    return result;
  }

  invalidate(domain: string): void {
    this.cache.delete(domain);
  }

  clear(): void {
    this.cache.clear();
  }
}
