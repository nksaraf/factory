/**
 * Resolve external links for catalog entities.
 * - Docker images → Hub / GHCR / GCP AR / ECR / Quay
 * - Source repo annotation → GitHub
 * - Catalog links[] pass through
 */

export interface ExternalLink {
  title: string
  url: string
  kind: "image" | "repo" | "docs" | "api-doc" | "custom"
}

const GITHUB_ORG_RE = /^([\w.-]+)\/([\w.-]+)$/

export function resolveImageLink(
  image: string | undefined | null
): ExternalLink | null {
  if (!image) return null
  const [repoRef] = image.split("@") // strip digest
  const [repo] = repoRef.split(":") // strip tag
  if (!repo) return null

  // Google Artifact Registry: region-docker.pkg.dev/project/repo/image
  if (repo.includes("-docker.pkg.dev/")) {
    const parts = repo.split("/")
    if (parts.length >= 4) {
      const [host, project, repoName, ...rest] = parts
      const region = host!.split("-")[0]
      const pkg = rest.join("%2F")
      return {
        title: "Artifact Registry",
        url: `https://console.cloud.google.com/artifacts/docker/${project}/${region}/${repoName}/${pkg}`,
        kind: "image",
      }
    }
  }

  // GitHub Container Registry
  if (repo.startsWith("ghcr.io/")) {
    const path = repo.slice("ghcr.io/".length)
    return {
      title: "GHCR",
      url: `https://github.com/${path.split("/").slice(0, 2).join("/")}/pkgs/container/${path.split("/").slice(-1)[0]}`,
      kind: "image",
    }
  }

  // Quay
  if (repo.startsWith("quay.io/")) {
    return {
      title: "Quay",
      url: `https://quay.io/repository/${repo.slice("quay.io/".length)}`,
      kind: "image",
    }
  }

  // AWS ECR Public
  if (repo.startsWith("public.ecr.aws/")) {
    return {
      title: "ECR Public",
      url: `https://gallery.ecr.aws/${repo.slice("public.ecr.aws/".length)}`,
      kind: "image",
    }
  }

  // Docker Hub (default) - either "library/x" or "user/x" or just "x"
  if (!repo.includes("/")) {
    return {
      title: "Docker Hub",
      url: `https://hub.docker.com/_/${repo}`,
      kind: "image",
    }
  }
  const slashParts = repo.split("/")
  if (slashParts.length === 2) {
    return {
      title: "Docker Hub",
      url: `https://hub.docker.com/r/${repo}`,
      kind: "image",
    }
  }

  return null
}

export function resolveRepoLink(
  annotations: Record<string, string> | undefined
): ExternalLink | null {
  if (!annotations) return null
  const source = annotations["dx.dev/source-repo"]
  if (!source) return null
  const path = annotations["dx.dev/source-path"]
  if (GITHUB_ORG_RE.test(source)) {
    const suffix = path ? `/tree/HEAD/${path}` : ""
    return {
      title: "Source",
      url: `https://github.com/${source}${suffix}`,
      kind: "repo",
    }
  }
  if (source.startsWith("http")) {
    return { title: "Source", url: source, kind: "repo" }
  }
  return null
}

export function resolveCatalogLinks(
  entry:
    | {
        metadata?: {
          links?: Array<{ url: string; title: string; type?: string }>
          annotations?: Record<string, string>
        }
        spec?: { image?: string; providesApis?: string[] }
      }
    | null
    | undefined,
  hostUrl?: string
): ExternalLink[] {
  if (!entry) return []
  const out: ExternalLink[] = []

  const repo = resolveRepoLink(entry.metadata?.annotations)
  if (repo) out.push(repo)

  const image = resolveImageLink(entry.spec?.image)
  if (image) out.push(image)

  for (const link of entry.metadata?.links ?? []) {
    let url = link.url
    if (url.startsWith("/") && hostUrl) {
      url = hostUrl.replace(/\/$/, "") + url
    }
    out.push({
      title: link.title,
      url,
      kind:
        link.type === "api-doc"
          ? "api-doc"
          : link.type === "doc"
            ? "docs"
            : "custom",
    })
  }

  return out
}
