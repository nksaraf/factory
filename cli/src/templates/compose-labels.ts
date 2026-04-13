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
    [`dx.port.${port.number}.name`]: port.name,
    [`dx.port.${port.number}.protocol`]: port.protocol,
  }
}

export function componentLabels(
  opts: ComponentLabelOpts
): Record<string, string> {
  const labels: Record<string, string> = {}

  if (opts.type) labels["dx.type"] = opts.type
  labels["dx.owner"] = opts.owner
  labels["dx.description"] = opts.description
  if (opts.runtime) labels["dx.runtime"] = opts.runtime
  Object.assign(labels, portLabels(opts.port))

  return labels
}

export function resourceLabels(
  opts: ResourceLabelOpts
): Record<string, string> {
  const labels: Record<string, string> = {
    "dx.type": opts.type,
    "dx.owner": opts.owner,
    "dx.description": opts.description,
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
