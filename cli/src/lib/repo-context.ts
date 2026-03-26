import { getFactoryClient } from "../client.js";
import { getRemoteUrl } from "./git.js";

export interface RepoContext {
  providerId: string;
  repoSlug: string;
  repoName: string;
  defaultBranch: string;
}

export async function resolveRepoContext(cwd: string): Promise<RepoContext> {
  const remoteUrl = getRemoteUrl(cwd);
  const api = await getFactoryClient();
  const res = await api.api.v1.factory.build.repos.get();
  const repos = res.data?.data;
  if (!repos || repos.length === 0) throw new Error("No repos found in factory");

  // Normalize URLs for matching (strip .git suffix, normalize SSH to HTTPS)
  function normalizeGitUrl(url: string): string {
    let u = url.trim().replace(/\.git$/, "");
    // Convert SSH to HTTPS: git@github.com:org/repo → https://github.com/org/repo
    const sshMatch = u.match(/^git@([^:]+):(.+)$/);
    if (sshMatch) u = `https://${sshMatch[1]}/${sshMatch[2]}`;
    return u.toLowerCase();
  }

  const normalized = normalizeGitUrl(remoteUrl);
  const match = repos.find((r) => normalizeGitUrl(r.gitUrl ?? "") === normalized);
  if (!match) throw new Error(`Repo with remote URL "${remoteUrl}" not found in factory`);

  if (!match.gitHostProviderId) {
    throw new Error(`Repo "${match.name}" has no git host provider configured`);
  }

  return {
    providerId: match.gitHostProviderId,
    repoSlug: match.slug ?? match.name,
    repoName: match.name,
    defaultBranch: match.defaultBranch ?? "main",
  };
}
