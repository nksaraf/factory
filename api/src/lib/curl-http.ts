/**
 * Shared curl-based HTTP client for Bun compatibility.
 *
 * Bun polyfills node:https with its own socket layer which drops
 * connections to external HTTPS APIs (e.g. Slack). curl bypasses
 * Bun's networking entirely.
 *
 * Used by:
 * - slack-client.ts (direct Slack API calls)
 * - bun-https-fix.ts (axios adapter for @slack/web-api)
 */
import { execFile } from "node:child_process"

function execFileAsync(
  cmd: string,
  args: string[]
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (err, stdout, stderr) => {
      if (err) {
        ;(err as any).stderr = stderr
        reject(err)
      } else {
        resolve({ stdout, stderr })
      }
    })
  })
}

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

export interface CurlRequest {
  url: string
  method?: string
  headers?: Record<string, string | null | undefined>
  body?: string | Record<string, unknown>
  timeoutSeconds?: number
}

export interface CurlResponse {
  data: any
  status: number
  statusText: string
  headers: Record<string, string>
}

/**
 * Make an HTTP request via curl subprocess.
 * Captures response headers for rate-limit handling.
 */
export async function curlRequest(req: CurlRequest): Promise<CurlResponse> {
  const timeout = req.timeoutSeconds ?? 30

  // -i includes response headers in stdout, which we parse for status + headers
  const args = [
    "-s",
    "-i",
    "--max-time",
    String(timeout),
    "-X",
    req.method?.toUpperCase() ?? "POST",
  ]

  // Add headers
  if (req.headers) {
    for (const [key, value] of Object.entries(req.headers)) {
      if (value !== undefined && value !== null && key !== "Content-Length") {
        args.push("-H", `${key}: ${value}`)
      }
    }
  }

  // Add body
  if (req.body !== undefined && req.body !== null) {
    const body =
      typeof req.body === "string" ? req.body : JSON.stringify(req.body)
    args.push("-d", body)
  }

  args.push(req.url)

  try {
    const { stdout } = await execFileAsync("curl", args)
    return parseResponse(stdout)
  } catch (err: any) {
    const detail = err.stderr?.trim() || err.message
    throw new Error(`curl request to ${req.url} failed: ${detail}`)
  }
}

/**
 * Parse curl -i output (headers + body).
 * Format: HTTP/1.1 200 OK\r\n<headers>\r\n\r\n<body>
 */
function parseResponse(raw: string): CurlResponse {
  // Find the blank line separating headers from body.
  // curl -i may include multiple HTTP response blocks (e.g. 100 Continue),
  // so find the LAST header/body separator.
  let headerEnd = -1
  let headerStart = 0
  let searchFrom = 0

  // Skip any "HTTP/1.1 100 Continue" blocks
  while (true) {
    const sep = raw.indexOf("\r\n\r\n", searchFrom)
    if (sep === -1) break
    headerEnd = sep
    // Check if body starts with another HTTP status line (redirect or 100 Continue)
    const afterSep = raw.slice(sep + 4)
    if (afterSep.startsWith("HTTP/")) {
      searchFrom = sep + 4
      headerStart = sep + 4
    } else {
      break
    }
  }

  if (headerEnd === -1) {
    // No header/body separator found — treat entire output as body
    return {
      data: tryParseJson(raw),
      status: 200,
      statusText: "OK",
      headers: {},
    }
  }

  const headerBlock = raw.slice(headerStart, headerEnd)
  const body = raw.slice(headerEnd + 4)

  // Parse status line
  const statusLine = headerBlock.split("\r\n")[0] ?? ""
  const statusMatch = statusLine.match(/HTTP\/[\d.]+ (\d+)/)
  const status = statusMatch ? parseInt(statusMatch[1], 10) : 200

  // Parse headers
  const headers: Record<string, string> = {}
  const headerLines = headerBlock.split("\r\n").slice(1)
  for (const line of headerLines) {
    const colonIdx = line.indexOf(":")
    if (colonIdx > 0) {
      const key = line.slice(0, colonIdx).trim().toLowerCase()
      const value = line.slice(colonIdx + 1).trim()
      headers[key] = value
    }
  }

  return {
    data: tryParseJson(body),
    status,
    statusText: STATUS_TEXT[status] ?? String(status),
    headers,
  }
}

function tryParseJson(s: string): any {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/**
 * Axios-compatible adapter wrapping curlRequest.
 * For use with @slack/web-api's WebClient via monkey-patching.
 */
export async function curlAxiosAdapter(config: any): Promise<any> {
  const rawUrl = config.url ?? ""
  const url =
    rawUrl.startsWith("http://") || rawUrl.startsWith("https://")
      ? rawUrl
      : config.baseURL
        ? `${config.baseURL.replace(/\/$/, "")}/${rawUrl.replace(/^\//, "")}`
        : rawUrl

  const response = await curlRequest({
    url,
    method: config.method,
    headers: config.headers,
    body: config.data,
    timeoutSeconds: config.timeout ? Math.ceil(config.timeout / 1000) : 30,
  })

  let pathname: string
  try {
    pathname = new URL(url).pathname
  } catch {
    pathname = url
  }

  return {
    data: response.data,
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
    config,
    request: { path: pathname },
  }
}
