/** Maps error codes to default suggestion templates (CLI standards §4.4–4.5). */
export const ErrorRegistry: Record<
  string,
  { message: string; suggestions: Array<{ action: string; description: string }> }
> = {
  NYI: {
    message: "Command not implemented yet",
    suggestions: [
      { action: "docs", description: "See docs/software-factory for roadmap" },
    ],
  },
  AUTH_DENIED: {
    message: "Authentication failed",
    suggestions: [
      { action: "dx auth login", description: "Sign in with email/password; session stored in ~/.config/dx/session.json" },
      { action: "dx whoami", description: "Verify stored session against the auth service" },
      { action: "config", description: "Set authUrl and authBasePath in ~/.config/dx/config.yaml" },
    ],
  },
  API_UNREACHABLE: {
    message: "Could not reach Factory API",
    suggestions: [
      { action: "dx status", description: "Confirm API URL in ~/.config/dx/config.yaml" },
      { action: "curl", description: "curl -sS $apiUrl/health" },
    ],
  },
  NOT_FOUND: {
    message: "Resource not found",
    suggestions: [{ action: "list", description: "List resources to validate names/ids" }],
  },
};
