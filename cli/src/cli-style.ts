/**
 * Terminal styling for human-readable CLI output.
 * @see https://crustjs.com/docs/modules/style
 */
import { createStyle } from "@crustjs/style"

const s = createStyle({ mode: "auto" })

export function styleError(text: string): string {
  return s.red(text)
}

export function styleSuccess(text: string): string {
  return s.green(text)
}

export function styleWarn(text: string): string {
  return s.yellow(text)
}

export function styleMuted(text: string): string {
  return s.dim(text)
}

export function styleInfo(text: string): string {
  return s.cyan(text)
}

export function styleBold(text: string): string {
  return s.bold(text)
}

/** Color a service status: green for healthy/running, red for exited/dead, yellow for other. */
export function styleServiceStatus(status: string): string {
  if (status === "running") return styleSuccess(status)
  if (status.includes("healthy")) return styleSuccess(status)
  if (status.includes("unhealthy")) return styleError(status)
  if (status === "exited" || status === "dead") return styleError(status)
  return styleWarn(status)
}
