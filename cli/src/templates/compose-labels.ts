interface PortSpec {
  number: number
  name: string
  protocol: string
}

interface ComponentLabelOpts {
  type?: string
  owner: string
  description: string
  runtime?: string
  port?: PortSpec
}

interface ResourceLabelOpts {
  type: string
  owner: string
  description: string
  port?: PortSpec
}

function portLabels(port: PortSpec | undefined): Record<string, string> {
  if (!port) return {}
  return {
    [`catalog.port.${port.number}.name`]: port.name,
    [`catalog.port.${port.number}.protocol`]: port.protocol,
  }
}

export function componentLabels(
  opts: ComponentLabelOpts
): Record<string, string> {
  const labels: Record<string, string> = {}

  if (opts.type) labels["catalog.type"] = opts.type
  labels["catalog.owner"] = opts.owner
  labels["catalog.description"] = opts.description
  if (opts.runtime) labels["dx.runtime"] = opts.runtime
  Object.assign(labels, portLabels(opts.port))

  return labels
}

export function resourceLabels(
  opts: ResourceLabelOpts
): Record<string, string> {
  const labels: Record<string, string> = {
    "catalog.type": opts.type,
    "catalog.owner": opts.owner,
    "catalog.description": opts.description,
    ...portLabels(opts.port),
  }
  return labels
}

/** Formats a labels record as an indented YAML label block string. */
export function labelsToYaml(
  labels: Record<string, string>,
  indent: number
): string {
  const spaces = " ".repeat(indent)
  return Object.entries(labels)
    .map(([key, value]) => `${spaces}${key}: "${value}"`)
    .join("\n")
}
