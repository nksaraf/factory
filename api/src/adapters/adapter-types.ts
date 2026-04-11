/**
 * Adapter pattern types and conventions.
 *
 * Factory uses adapters to integrate with external services. Every adapter
 * category follows one of three config patterns:
 *
 * **Pattern A: Constructor-configured** (git host, gateway)
 *   Config provided at creation time; adapter holds state (tokens, clients).
 *   ```ts
 *   const adapter = getGitHostAdapter("github", { token, webhookSecret });
 *   adapter.listRepos(); // uses stored token
 *   ```
 *
 * **Pattern B: Per-call config (stateless)** (work tracker, messaging)
 *   Adapter is a stateless strategy; credentials passed per method call.
 *   ```ts
 *   const adapter = getWorkTrackerAdapter("jira");
 *   adapter.listItems(apiUrl, credentialsRef, query);
 *   ```
 *
 * **Pattern C: DI-injected** (VM provider)
 *   Requires Database at construction; provider entity passed per call.
 *   ```ts
 *   const adapter = getVMProviderAdapter("proxmox", db);
 *   adapter.syncInventory(providerEntity);
 *   ```
 *
 * Naming conventions:
 *   Interface file:       {category}-adapter.ts
 *   Implementation file:  {category}-adapter-{backend}.ts
 *   Interface name:       {Category}Adapter
 *   Implementation name:  {Backend}{Category}Adapter
 *   Noop class:           Noop{Category}Adapter
 *   Factory function:     get{Category}Adapter(type, ...)
 *   Type literal union:   {Category}Type (in interface file)
 */

export type AdapterCategory =
  | "git-host"
  | "work-tracker"
  | "messaging"
  | "observability"
  | "vm-provider"
  | "gateway"
  | "sandbox"
  | "network-device"
