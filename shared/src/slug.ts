/** Max stored slug length (URL-safe segment). */
export const SLUG_MAX_LENGTH = 80;

/** Slug format: lowercase segments separated by single hyphens. */
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const ADJECTIVES = [
  "swift",
  "calm",
  "bright",
  "quiet",
  "bold",
  "gentle",
  "rapid",
  "steady",
  "clear",
  "warm",
  "cool",
  "fresh",
  "keen",
  "noble",
  "proud",
  "lucky",
  "happy",
  "brave",
  "wise",
  "kind",
  "fair",
  "grand",
  "plain",
  "quick",
  "sharp",
  "smooth",
  "tough",
  "vivid",
  "wild",
  "young",
] as const;

const NOUNS = [
  "river",
  "oak",
  "harbor",
  "summit",
  "canyon",
  "delta",
  "forest",
  "pebble",
  "anchor",
  "beacon",
  "compass",
  "harvest",
  "horizon",
  "island",
  "journey",
  "kernel",
  "lantern",
  "orchard",
  "pioneer",
  "quartz",
  "ridge",
  "shelter",
  "thistle",
  "voyage",
  "willow",
  "meadow",
  "brook",
  "coral",
  "ember",
  "falcon",
] as const;

function randomInt(max: number): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0]! % max;
}

function randomHexByteLen(bytes: number): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * URL-safe slug from a human label: NFKD, strip marks, lowercase,
 * non-alphanumeric → hyphens, collapse trim, max length.
 */
export function slugifyFromLabel(label: string): string {
  const trimmed = label.trim();
  if (!trimmed) return "";
  const normalized = trimmed
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  const dashed = normalized.replace(/[^a-z0-9]+/g, "-");
  const collapsed = dashed
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return truncateSlugSegment(collapsed, SLUG_MAX_LENGTH);
}

function truncateSlugSegment(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastHyphen = cut.lastIndexOf("-");
  if (lastHyphen > max * 0.4) return cut.slice(0, lastHyphen).replace(/-+$/, "") || cut.slice(0, max);
  return cut.replace(/-+$/, "");
}

/**
 * Fallback when slugify yields empty: adj-noun-adj-hex (memorable + unique).
 */
export function generateMemorableSlug(): string {
  const a = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
  const n = NOUNS[randomInt(NOUNS.length)]!;
  const b = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
  const hex = randomHexByteLen(3);
  const raw = `${a}-${n}-${b}-${hex}`;
  return truncateSlugSegment(raw, SLUG_MAX_LENGTH);
}

/**
 * Short slug for branch disambiguation: adjective + 4-char hex.
 * Example: "swift-a3b2"
 */
export function generateBranchSlug(): string {
  const adj = ADJECTIVES[randomInt(ADJECTIVES.length)]!;
  const hex = randomHexByteLen(2);
  return `${adj}-${hex}`;
}

export class InvalidSlugError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidSlugError";
  }
}

export function validateExplicitSlug(slug: string): string {
  const t = slug.trim().toLowerCase();
  if (!t) throw new InvalidSlugError("Slug cannot be empty");
  if (!SLUG_PATTERN.test(t)) {
    throw new InvalidSlugError(
      "Slug must be lowercase letters, digits, and single hyphens between segments"
    );
  }
  if (t.length > SLUG_MAX_LENGTH) {
    throw new InvalidSlugError(`Slug must be at most ${SLUG_MAX_LENGTH} characters`);
  }
  return t;
}

function withNumericSuffix(base: string, counter: number): string {
  if (counter === 0) return truncateSlugSegment(base, SLUG_MAX_LENGTH);
  const suffix = `-${counter}`;
  const room = SLUG_MAX_LENGTH - suffix.length;
  const prefix = room > 0 ? truncateSlugSegment(base, room) : "";
  const combined = `${prefix}${suffix}`;
  return combined.length <= SLUG_MAX_LENGTH
    ? combined
    : `${prefix.slice(0, Math.max(1, SLUG_MAX_LENGTH - suffix.length))}${suffix}`;
}

/**
 * Resolves a unique slug: optional explicit (validated + uniqueness check),
 * else slugify(baseLabel) with -2, -3, … style numeric suffixes on collision.
 */
export async function allocateSlug(options: {
  baseLabel: string;
  explicitSlug?: string | null | undefined;
  isTaken: (slug: string) => Promise<boolean>;
}): Promise<string> {
  const { explicitSlug, baseLabel, isTaken } = options;
  if (explicitSlug != null && explicitSlug !== "") {
    const candidate = validateExplicitSlug(explicitSlug);
    if (await isTaken(candidate)) {
      throw new InvalidSlugError(`Slug already in use: ${candidate}`);
    }
    return candidate;
  }

  let base = slugifyFromLabel(baseLabel);
  if (base.length === 0) {
    base = generateMemorableSlug();
  }

  for (let counter = 0; counter < 10_000; counter++) {
    const candidate =
      counter === 0
        ? withNumericSuffix(base, 0)
        : withNumericSuffix(base, counter + 1);
    if (!(await isTaken(candidate))) return candidate;
  }

  throw new Error("Could not allocate a unique slug");
}
