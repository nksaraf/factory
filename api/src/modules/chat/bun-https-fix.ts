/**
 * Workaround for Bun's broken node:https TLS implementation.
 *
 * Bun polyfills node:https with its own socket layer which drops
 * connections to external HTTPS APIs (e.g. Slack). The Chat SDK's
 * @slack/web-api uses axios → node:https under the hood, so outbound
 * Slack API calls fail in Bun.
 *
 * This module monkey-patches @slack/web-api's WebClient to inject a
 * curl-based axios adapter for all outbound requests, matching the
 * approach used by our existing slack-client.ts.
 *
 * MUST be imported before @chat-adapter/slack or any Chat SDK module.
 */
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const STATUS_TEXT: Record<number, string> = {
  200: "OK",
  201: "Created",
  204: "No Content",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  429: "Too Many Requests",
  500: "Internal Server Error",
}

/**
 * Axios adapter that uses curl subprocess for HTTP requests.
 * Returns a proper axios-compatible response object.
 *
 * Note: response headers are not captured — Slack rate-limit headers
 * (Retry-After) won't be available. WebClient's built-in retry logic
 * falls back to exponential backoff when headers are missing.
 */
async function curlAdapter(config: any): Promise<any> {
  const rawUrl = config.url ?? ""
  // If url is already absolute, use it directly; otherwise prepend baseURL
  const url =
    rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : config.baseURL
        ? `${config.baseURL.replace(/\/$/, "")}/${rawUrl.replace(/^\//, "")}`
        : rawUrl

  // -w appends HTTP status code after response body, separated by newline
  const args = [
    "-s",
    "--max-time",
    "30",
    "-w",
    "\n%{http_code}",
    "-X",
    config.method?.toUpperCase() ?? "POST",
  ]

  // Add headers
  const headers = config.headers ?? {}
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined && value !== null && key !== "Content-Length") {
      args.push("-H", `${key}: ${value}`)
    }
  }

  // Add body
  if (config.data !== undefined && config.data !== null) {
    const body =
      typeof config.data === "string"
        ? config.data
        : JSON.stringify(config.data)
    args.push("-d", body)
  }

  args.push(url)

  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }

  try {
    const { stdout } = await execFileAsync("curl", args)

    // Split response body from status code (last line)
    const lastNewline = stdout.lastIndexOf("\n")
    const responseBody =
      lastNewline >= 0 ? stdout.slice(0, lastNewline) : stdout
    const statusStr =
      lastNewline >= 0 ? stdout.slice(lastNewline + 1).trim() : "200"
    const status = parseInt(statusStr, 10) || 200

    let data: any
    try {
      data = JSON.parse(responseBody)
    } catch {
      data = responseBody
    }

    return {
      data,
      status,
      statusText: STATUS_TEXT[status] ?? String(status),
      headers: {},
      config,
      request: { path: pathname },
    }
  } catch (err: any) {
    const detail = err.stderr?.trim() || err.message
    throw new Error(`curl request to ${url} failed: ${detail}`)
  }
}

// Monkey-patch the WebClient class to inject the curl adapter
try {
  const { WebClient } = await import("@slack/web-api")
  const OriginalConstructor = WebClient as any

  const origMakeRequest = OriginalConstructor.prototype.makeRequest

  OriginalConstructor.prototype.makeRequest = function (
    this: any,
    url: string,
    body: any,
    headers: Record<string, string> = {}
  ) {
    // Inject curl adapter on first request if not already set
    if (this.axios && !this._curlPatched) {
      this.axios.defaults.adapter = curlAdapter
      this._curlPatched = true
    }
    return origMakeRequest.call(this, url, body, headers)
  }
} catch {
  // @slack/web-api not available — nothing to patch
}
