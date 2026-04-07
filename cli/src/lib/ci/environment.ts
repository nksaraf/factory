export type CIEnvironment = "local" | "github-actions" | "sandbox";

export function detectEnvironment(): CIEnvironment {
  if (process.env.GITHUB_ACTIONS) return "github-actions";
  if (process.env.DX_SANDBOX_ID) return "sandbox";
  return "local";
}

export function isCI(): boolean {
  return detectEnvironment() !== "local";
}
