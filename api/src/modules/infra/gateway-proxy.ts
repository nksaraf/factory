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
