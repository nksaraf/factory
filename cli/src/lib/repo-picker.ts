export interface RepoPickerRepo {
  name?: string | null;
  gitUrl?: string | null;
}

function trimGitSuffix(value: string): string {
  return value.replace(/\.git$/, "");
}

function parseRepoPath(gitUrl: string): string | null {
  const trimmed = trimGitSuffix(gitUrl.trim());
  if (!trimmed) return null;

  const sshMatch = trimmed.match(/^git@[^:]+:(.+)$/);
  if (sshMatch) return sshMatch[1] ?? null;

  try {
    const url = new URL(trimmed);
    return url.pathname.replace(/^\/+/, "") || null;
  } catch {
    return null;
  }
}

export function getRepoDisplayName(repo: RepoPickerRepo): string {
  return parseRepoPath(repo.gitUrl ?? "") ?? repo.name ?? "repo";
}
