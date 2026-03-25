import fs from "node:fs"
import path from "node:path"

import { logger } from "../logger"
import type { GatewayAdapter, GatewayCRD, ApplyResult } from "./gateway-adapter"

/**
 * Serialize a GatewayCRD to basic YAML without a yaml dependency.
 * Handles the known CRD structure: apiVersion, kind, metadata, spec.
 */
function crdToYaml(crd: GatewayCRD): string {
  const lines: string[] = []

  lines.push(`apiVersion: "${crd.apiVersion}"`)
  lines.push(`kind: "${crd.kind}"`)
  lines.push("metadata:")
  lines.push(`  name: "${crd.metadata.name}"`)
  lines.push(`  namespace: "${crd.metadata.namespace}"`)
  lines.push("  labels:")
  for (const [key, value] of Object.entries(crd.metadata.labels)) {
    lines.push(`    ${key}: "${value}"`)
  }
  lines.push("spec:")
  for (const [key, value] of Object.entries(crd.spec)) {
    lines.push(`  ${key}: ${JSON.stringify(value)}`)
  }

  return lines.join("\n") + "\n"
}

/**
 * Parse a basic YAML file back to a GatewayCRD.
 * Only handles the structure produced by crdToYaml.
 */
function yamlToCrd(content: string): GatewayCRD {
  const lines = content.split("\n").filter((l) => l.trim() !== "")

  const crd: GatewayCRD = {
    apiVersion: "",
    kind: "",
    metadata: { name: "", namespace: "", labels: {} },
    spec: {},
  }

  let section: "root" | "metadata" | "labels" | "spec" = "root"

  for (const line of lines) {
    const trimmed = line.trimStart()

    if (trimmed.startsWith("apiVersion:")) {
      crd.apiVersion = stripQuotes(trimmed.split(": ", 2)[1])
      section = "root"
    } else if (trimmed.startsWith("kind:")) {
      crd.kind = stripQuotes(trimmed.split(": ", 2)[1])
      section = "root"
    } else if (trimmed === "metadata:") {
      section = "metadata"
    } else if (trimmed === "spec:") {
      section = "spec"
    } else if (trimmed === "labels:" && section === "metadata") {
      section = "labels"
    } else if (section === "metadata" && trimmed.startsWith("name:")) {
      crd.metadata.name = stripQuotes(trimmed.split(": ", 2)[1])
    } else if (section === "metadata" && trimmed.startsWith("namespace:")) {
      crd.metadata.namespace = stripQuotes(trimmed.split(": ", 2)[1])
    } else if (section === "labels") {
      const colonIdx = trimmed.indexOf(": ")
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx)
        const value = stripQuotes(trimmed.slice(colonIdx + 2))
        crd.metadata.labels[key] = value
      }
    } else if (section === "spec") {
      const colonIdx = trimmed.indexOf(": ")
      if (colonIdx !== -1) {
        const key = trimmed.slice(0, colonIdx)
        const raw = trimmed.slice(colonIdx + 2)
        try {
          crd.spec[key] = JSON.parse(raw)
        } catch {
          crd.spec[key] = stripQuotes(raw)
        }
      }
    }
  }

  return crd
}

function stripQuotes(s: string): string {
  const trimmed = s.trim()
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }
  return trimmed
}

/**
 * Atomically write content to a file (write temp -> rename).
 * Prevents consumers from reading a partially-written file.
 */
function atomicWrite(filePath: string, content: string): void {
  const dir = path.dirname(filePath)
  const tmpFile = path.join(dir, `.${path.basename(filePath)}.tmp.${process.pid}`)
  fs.writeFileSync(tmpFile, content, "utf-8")
  fs.renameSync(tmpFile, filePath)
}

export class FileGatewayAdapter implements GatewayAdapter {
  readonly type = "file"

  constructor(private readonly outputDir: string) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
  }

  async apply(crds: GatewayCRD[]): Promise<ApplyResult> {
    const errors: Array<{ name: string; error: string }> = []
    let applied = 0

    for (const crd of crds) {
      try {
        const filePath = path.join(this.outputDir, `${crd.metadata.name}.yml`)
        const yaml = crdToYaml(crd)
        atomicWrite(filePath, yaml)
        applied++
      } catch (err: any) {
        logger.error(
          { name: crd.metadata.name, err },
          "file gateway adapter: failed to write CRD"
        )
        errors.push({ name: crd.metadata.name, error: err.message })
      }
    }

    logger.info(
      { applied, errorCount: errors.length },
      "file gateway adapter: apply"
    )
    return { applied, errors }
  }

  async getCurrentState(): Promise<GatewayCRD[]> {
    if (!fs.existsSync(this.outputDir)) {
      return []
    }

    const files = fs.readdirSync(this.outputDir).filter((f) => f.endsWith(".yml"))
    const crds: GatewayCRD[] = []

    for (const file of files) {
      try {
        const content = fs.readFileSync(
          path.join(this.outputDir, file),
          "utf-8"
        )
        crds.push(yamlToCrd(content))
      } catch (err: any) {
        logger.error(
          { file, err },
          "file gateway adapter: failed to read CRD"
        )
      }
    }

    return crds
  }

  async delete(names: string[]): Promise<void> {
    logger.info({ names }, "file gateway adapter: delete")
    for (const name of names) {
      const filePath = path.join(this.outputDir, `${name}.yml`)
      try {
        fs.unlinkSync(filePath)
      } catch (err: any) {
        if (err.code !== "ENOENT") {
          logger.error(
            { name, err },
            "file gateway adapter: failed to delete CRD file"
          )
        }
      }
    }
  }
}
