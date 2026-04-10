/**
 * Interactive prompts for the infrastructure scan flow.
 * All functions accept a `json` param — when true, returns defaults without prompting.
 */
import { styleBold, styleMuted } from "../../cli-style.js"
import type { ScanResult } from "./types.js"
// ── Component review prompt ──────────────────────────────────

import type { ScanService } from "./types.js"

// ── Types ────────────────────────────────────────────────────

export interface HostRegistrationResult {
  register: boolean
  name: string
  slug: string
  role: string
}

export interface SystemAssignment {
  action: "create" | "assign" | "skip"
  systemSlug: string
  systemName: string
}

export interface ComponentOverride {
  originalName: string
  action: "keep" | "rename" | "assign" | "skip"
  name: string
  slug: string
}

export interface ExistingSystem {
  slug: string
  name: string
}

export interface ExistingComponent {
  slug: string
  name: string
  systemSlug?: string
}

// ── Helpers ──────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100)
}

function formatOs(os?: string): string {
  if (os === "macos") return "macOS"
  if (os === "windows") return "Windows"
  if (os === "linux") return "Linux"
  return os ?? "unknown"
}

function formatArch(arch?: string): string {
  if (arch === "arm64") return "arm64 (Apple Silicon)"
  if (arch === "amd64") return "amd64 (x86_64)"
  return arch ?? "unknown"
}

// ── Machine summary display ──────────────────────────────────

export function printMachineSummary(scanResult: ScanResult): void {
  console.log(styleBold("\n  Machine detected:"))
  console.log(`    Hostname:  ${scanResult.hostname ?? "unknown"}`)
  console.log(`    OS:        ${formatOs(scanResult.os)}`)
  console.log(`    Arch:      ${formatArch(scanResult.arch)}`)
  if (scanResult.ipAddress) {
    console.log(`    IP:        ${scanResult.ipAddress}`)
  }
  console.log()
}

// ── Host registration prompt ─────────────────────────────────

export async function promptHostRegistration(
  scanResult: ScanResult,
  json: boolean
): Promise<HostRegistrationResult | null> {
  const defaultName = scanResult.hostname ?? "unknown-host"
  const defaultSlug = slugify(defaultName)
  const defaultRole =
    scanResult.os === "macos" ? "developer-workstation" : "server"

  if (json) {
    return {
      register: true,
      name: defaultName,
      slug: defaultSlug,
      role: defaultRole,
    }
  }

  const { confirm, input, select } = await import("@crustjs/prompts")

  const register = await confirm({
    message: "Register this machine as a host in Factory?",
    initial: true,
  })

  if (!register) return null

  const name = await input({
    message: "Host name",
    default: defaultName,
    validate: (v: string) => (v.trim() ? true : "Host name is required"),
  })

  const slug = await input({
    message: "Host slug",
    default: slugify(name),
    validate: (v: string) => {
      if (!v.trim()) return "Slug is required"
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v))
        return "Slug must be lowercase alphanumeric with hyphens"
      return true
    },
  })

  const role = await select<string>({
    message: "Role",
    choices: [
      {
        value: "developer-workstation",
        label: "Developer workstation",
        hint: "Personal dev machine",
      },
      { value: "server", label: "Server", hint: "Production/staging server" },
      {
        value: "build-agent",
        label: "Build agent",
        hint: "CI/CD build machine",
      },
      { value: "other", label: "Other...", hint: "Enter a custom role" },
    ],
    default: defaultRole,
  })

  let finalRole = role
  if (role === "other") {
    finalRole = await input({
      message: "Custom role",
      validate: (v: string) => (v.trim() ? true : "Role is required"),
    })
  }

  return { register: true, name, slug, role: finalRole }
}

// ── System assignment prompt (for compose projects) ──────────

export async function promptSystemAssignment(
  projectName: string,
  serviceCount: number,
  existingSystems: ExistingSystem[],
  json: boolean
): Promise<SystemAssignment> {
  const defaultSlug = slugify(projectName)

  if (json) {
    return {
      action: "create",
      systemSlug: defaultSlug,
      systemName: projectName,
    }
  }

  const { select, input } = await import("@crustjs/prompts")

  type Action = "create" | "assign" | "skip"
  const choices: { value: Action; label: string; hint?: string }[] = [
    { value: "create", label: `Create new system "${projectName}"` },
  ]

  if (existingSystems.length > 0) {
    choices.push({
      value: "assign",
      label: "Assign to existing system...",
      hint: `${existingSystems.length} systems available`,
    })
  }

  choices.push({
    value: "skip",
    label: "Skip (don't register)",
    hint: "Services won't be tracked",
  })

  const action = await select<Action>({
    message: `"${projectName}" — ${serviceCount} service${serviceCount !== 1 ? "s" : ""} detected`,
    choices,
    default: "create",
  })

  if (action === "skip") {
    return { action: "skip", systemSlug: "", systemName: "" }
  }

  if (action === "assign") {
    const assignSlug = await select<string>({
      message: `Assign "${projectName}" services to:`,
      choices: existingSystems.map((s) => ({
        value: s.slug,
        label: s.name,
        hint: s.slug,
      })),
    })

    const assignedSystem = existingSystems.find((s) => s.slug === assignSlug)
    return {
      action: "assign",
      systemSlug: assignSlug,
      systemName: assignedSystem?.name ?? assignSlug,
    }
  }

  // "create" — let user customize name and slug
  const systemName = await input({
    message: "System name",
    default: projectName,
    validate: (v: string) => (v.trim() ? true : "Name is required"),
  })

  const systemSlug = await input({
    message: "System slug",
    default: slugify(systemName),
    validate: (v: string) => {
      if (!v.trim()) return "Slug is required"
      if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v))
        return "Slug must be lowercase alphanumeric with hyphens"
      return true
    },
  })

  return { action: "create", systemSlug, systemName }
}

// ── Catch-all system prompt (for ungrouped services) ─────────

export async function promptCatchAllSystem(
  hostSlug: string,
  serviceCount: number,
  existingSystems: ExistingSystem[],
  json: boolean
): Promise<SystemAssignment> {
  const defaultSlug = `${hostSlug}-services`
  const defaultName = `${hostSlug} Services`

  if (json) {
    return {
      action: "create",
      systemSlug: defaultSlug,
      systemName: defaultName,
    }
  }

  const { select } = await import("@crustjs/prompts")

  type Action = "create" | "assign" | "skip"
  const choices: { value: Action; label: string; hint?: string }[] = [
    {
      value: "create",
      label: `Group under "${defaultSlug}" (new)`,
      hint: "Catch-all for ungrouped services",
    },
  ]

  if (existingSystems.length > 0) {
    choices.push({
      value: "assign",
      label: "Assign to existing system...",
      hint: `${existingSystems.length} systems available`,
    })
  }

  choices.push({
    value: "skip",
    label: "Skip all",
    hint: "Ungrouped services won't be tracked",
  })

  const action = await select<Action>({
    message: `${serviceCount} other service${serviceCount !== 1 ? "s" : ""} with listening ports`,
    choices,
    default: "create",
  })

  if (action === "skip") {
    return { action: "skip", systemSlug: "", systemName: "" }
  }

  if (action === "assign") {
    const assignSlug = await select<string>({
      message: "Assign ungrouped services to:",
      choices: existingSystems.map((s) => ({
        value: s.slug,
        label: s.name,
        hint: s.slug,
      })),
    })

    const assignedSystem = existingSystems.find((s) => s.slug === assignSlug)
    return {
      action: "assign",
      systemSlug: assignSlug,
      systemName: assignedSystem?.name ?? assignSlug,
    }
  }

  return { action: "create", systemSlug: defaultSlug, systemName: defaultName }
}

/**
 * Prompt user to review/rename/remap individual services (components).
 * Shows a summary of detected services and lets the user pick which to customize.
 */
export async function promptComponentOverrides(
  services: ScanService[],
  systemLabel: string,
  existingComponents: ExistingComponent[],
  json: boolean
): Promise<ComponentOverride[]> {
  if (services.length === 0) return []

  // In non-interactive mode, keep all with defaults
  if (json) {
    return services.map((svc) => ({
      originalName: svc.name,
      action: "keep" as const,
      name: svc.displayName ?? svc.name,
      slug: slugify(svc.name),
    }))
  }

  const { select, input } = await import("@crustjs/prompts")

  // Show services and ask if user wants to customize any
  console.log(styleMuted(`\n  Services in ${styleBold(systemLabel)}:`))
  for (const svc of services) {
    const ports =
      svc.ports.length > 0 ? styleMuted(` :${svc.ports.join(", :")}`) : ""
    console.log(`    ${svc.name}${ports}`)
  }

  type ReviewAction = "accept" | "review"
  const reviewAction = await select<ReviewAction>({
    message: `Review ${services.length} component${services.length !== 1 ? "s" : ""}?`,
    choices: [
      {
        value: "accept",
        label: "Accept all as-is",
        hint: "Use detected names",
      },
      {
        value: "review",
        label: "Review each component...",
        hint: "Rename, assign, or skip",
      },
    ],
    default: "accept",
  })

  if (reviewAction === "accept") {
    return services.map((svc) => ({
      originalName: svc.name,
      action: "keep" as const,
      name: svc.displayName ?? svc.name,
      slug: slugify(svc.name),
    }))
  }

  // Review each service
  const overrides: ComponentOverride[] = []
  for (const svc of services) {
    const defaultSlug = slugify(svc.name)
    const ports = svc.ports.length > 0 ? ` :${svc.ports.join(", :")}` : ""

    type CmpAction = "keep" | "rename" | "assign" | "skip"
    const choices: { value: CmpAction; label: string; hint?: string }[] = [
      { value: "keep", label: `Keep "${svc.name}"`, hint: defaultSlug },
      { value: "rename", label: "Rename...", hint: "Set custom name and slug" },
    ]

    if (existingComponents.length > 0) {
      choices.push({
        value: "assign",
        label: "Map to existing component...",
        hint: `${existingComponents.length} available`,
      })
    }

    choices.push({
      value: "skip",
      label: "Skip",
      hint: "Don't track this service",
    })

    const action = await select<CmpAction>({
      message: `${svc.name}${ports}`,
      choices,
      default: "keep",
    })

    if (action === "skip") {
      overrides.push({
        originalName: svc.name,
        action: "skip",
        name: "",
        slug: "",
      })
      continue
    }

    if (action === "assign") {
      const assignSlug = await select<string>({
        message: `Map "${svc.name}" to:`,
        choices: existingComponents.map((c) => ({
          value: c.slug,
          label: c.name,
          hint: c.systemSlug ? `${c.systemSlug}/${c.slug}` : c.slug,
        })),
      })
      const assigned = existingComponents.find((c) => c.slug === assignSlug)
      overrides.push({
        originalName: svc.name,
        action: "assign",
        name: assigned?.name ?? assignSlug,
        slug: assignSlug,
      })
      continue
    }

    if (action === "rename") {
      const newName = await input({
        message: "Component name",
        default: svc.displayName ?? svc.name,
        validate: (v: string) => (v.trim() ? true : "Name is required"),
      })
      const newSlug = await input({
        message: "Component slug",
        default: slugify(newName),
        validate: (v: string) => {
          if (!v.trim()) return "Slug is required"
          if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(v))
            return "Slug must be lowercase alphanumeric with hyphens"
          return true
        },
      })
      overrides.push({
        originalName: svc.name,
        action: "rename",
        name: newName,
        slug: newSlug,
      })
      continue
    }

    // keep
    overrides.push({
      originalName: svc.name,
      action: "keep",
      name: svc.displayName ?? svc.name,
      slug: defaultSlug,
    })
  }

  return overrides
}

// ── Apply system assignments to scan result ──────────────────

/**
 * Apply user's system and component assignment choices to a scan result.
 * Returns a new ScanResult without mutating the original.
 * - System "assign" → rewrite composeProject to the assigned system's slug
 * - System "skip" → remove those services
 * - Component "skip" → remove service
 * - Component "rename" → rewrite name/displayName
 * - Component "assign" → rewrite name to existing component slug
 */
export function applyScanOverrides(
  scanResult: ScanResult,
  composeOverrides: Map<string, SystemAssignment>,
  catchAllOverride: SystemAssignment | null,
  componentOverrides?: ComponentOverride[]
): ScanResult {
  const cmpOverrideMap = new Map<string, ComponentOverride>()
  if (componentOverrides) {
    for (const co of componentOverrides) {
      cmpOverrideMap.set(co.originalName, co)
    }
  }

  // Filter/rewrite compose services (clone to avoid mutating originals)
  const services = scanResult.services
    .filter((svc) => {
      // System-level skip
      if (svc.composeProject) {
        const override = composeOverrides.get(svc.composeProject)
        if (override?.action === "skip") return false
      } else if (catchAllOverride?.action === "skip") {
        return false
      }
      // Component-level skip
      const cmpOverride = cmpOverrideMap.get(svc.name)
      if (cmpOverride?.action === "skip") return false
      return true
    })
    .map((svc) => {
      let updated = svc

      // System-level rewrite
      if (svc.composeProject) {
        const override = composeOverrides.get(svc.composeProject)
        if (override?.action === "assign") {
          updated = { ...updated, composeProject: override.systemSlug }
        }
      }

      // Component-level rewrite
      const cmpOverride = cmpOverrideMap.get(svc.name)
      if (cmpOverride?.action === "rename") {
        updated = {
          ...updated,
          name: cmpOverride.slug,
          displayName: cmpOverride.name,
        }
      } else if (cmpOverride?.action === "assign") {
        updated = {
          ...updated,
          name: cmpOverride.slug,
          displayName: cmpOverride.name,
        }
      }

      return updated === svc ? svc : updated
    })

  // Filter/rewrite compose projects
  const composeProjects = scanResult.composeProjects
    .filter((p) => {
      const override = composeOverrides.get(p.name)
      return !override || override.action !== "skip"
    })
    .map((p) => {
      const override = composeOverrides.get(p.name)
      if (override?.action === "assign") {
        return { ...p, name: override.systemSlug }
      }
      // For "create" with custom name, rewrite the compose project name
      if (
        override?.action === "create" &&
        override.systemSlug !== slugify(p.name)
      ) {
        return { ...p, name: override.systemSlug }
      }
      return p
    })

  return { ...scanResult, services, composeProjects }
}
