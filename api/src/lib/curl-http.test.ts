import { createRequire } from "node:module"
import { beforeEach, describe, expect, it, mock } from "bun:test"

const require = createRequire(import.meta.url)
const realCp =
  require("node:child_process") as typeof import("node:child_process")

const mockExecFile = mock()

mock.module("node:child_process", () => ({
  ...realCp,
  execFile: (...args: any[]) => mockExecFile(...args),
}))

const { curlRequest, curlAxiosAdapter } = await import("./curl-http")

/** Build a curl -i style response (headers + body) */
function httpResponse(
  body: string,
  status = 200,
  headers: Record<string, string> = {}
): string {
  const statusText =
    {
      200: "OK",
      201: "Created",
      204: "No Content",
      400: "Bad Request",
      401: "Unauthorized",
      403: "Forbidden",
      404: "Not Found",
      429: "Too Many Requests",
      500: "Internal Server Error",
    }[status] ?? String(status)

  const headerLines = [`HTTP/1.1 ${status} ${statusText}`]
  for (const [k, v] of Object.entries(headers)) {
    headerLines.push(`${k}: ${v}`)
  }
  return headerLines.join("\r\n") + "\r\n\r\n" + body
}

function mockCurl(
  body: string,
  status = 200,
  headers: Record<string, string> = {}
) {
  mockExecFile.mockImplementation((...allArgs: any[]) => {
    const cb = allArgs[2]
    if (typeof cb !== "function") return
    cb(null, httpResponse(body, status, headers), "")
  })
}

function mockCurlFailure(message: string, stderr = "") {
  mockExecFile.mockImplementation((...allArgs: any[]) => {
    const cb = allArgs[2]
    if (typeof cb !== "function") return
    const err: any = new Error(message)
    err.stderr = stderr
    cb(err, "", stderr)
  })
}

function getCurlArgs(): string[] {
  return mockExecFile.mock.calls[0][1] as string[]
}

describe("curlRequest", () => {
  beforeEach(() => mockExecFile.mockReset())

  it("parses JSON response with status and headers", async () => {
    mockCurl('{"ok":true}', 200, {
      "content-type": "application/json",
      "retry-after": "30",
    })
    const result = await curlRequest({
      url: "https://slack.com/api/v1/auth.test",
    })
    expect(result.data).toEqual({ ok: true })
    expect(result.status).toBe(200)
    expect(result.statusText).toBe("OK")
    expect(result.headers["retry-after"]).toBe("30")
    expect(result.headers["content-type"]).toBe("application/json")
  })

  it("returns non-JSON body as string", async () => {
    mockCurl("plain text", 200)
    const result = await curlRequest({ url: "https://example.com/text" })
    expect(result.data).toBe("plain text")
  })

  it("preserves HTTP error status codes", async () => {
    const cases: [number, string][] = [
      [400, "Bad Request"],
      [401, "Unauthorized"],
      [429, "Too Many Requests"],
      [500, "Internal Server Error"],
    ]
    for (const [code, text] of cases) {
      mockCurl('{"ok":false}', code)
      const result = await curlRequest({
        url: "https://slack.com/api/test",
      })
      expect(result.status).toBe(code)
      expect(result.statusText).toBe(text)
    }
  })

  it("handles 204 No Content with empty body", async () => {
    mockCurl("", 204)
    const result = await curlRequest({ url: "https://slack.com/api/test" })
    expect(result.status).toBe(204)
    expect(result.statusText).toBe("No Content")
    expect(result.data).toBe("")
  })

  it("captures Retry-After header for rate limiting", async () => {
    mockCurl('{"ok":false,"error":"ratelimited"}', 429, {
      "Retry-After": "15",
    })
    const result = await curlRequest({ url: "https://slack.com/api/test" })
    expect(result.status).toBe(429)
    expect(result.headers["retry-after"]).toBe("15")
  })

  it("passes headers but filters Content-Length", async () => {
    mockCurl('{"ok":true}')
    await curlRequest({
      url: "https://slack.com/api/test",
      headers: {
        Authorization: "Bearer xoxb-test",
        "Content-Type": "application/json",
        "Content-Length": "42",
      },
    })
    const args = getCurlArgs()
    expect(args).toContain("Authorization: Bearer xoxb-test")
    expect(args).toContain("Content-Type: application/json")
    expect(args.join(" ")).not.toContain("Content-Length")
  })

  it("skips null/undefined header values", async () => {
    mockCurl('{"ok":true}')
    await curlRequest({
      url: "https://slack.com/api/test",
      headers: { "X-Null": null, "X-Undef": undefined, "X-Valid": "yes" },
    })
    const args = getCurlArgs()
    expect(args.join(" ")).not.toContain("X-Null")
    expect(args.join(" ")).not.toContain("X-Undef")
    expect(args).toContain("X-Valid: yes")
  })

  it("serializes object body as JSON", async () => {
    mockCurl('{"ok":true}')
    await curlRequest({
      url: "https://slack.com/api/chat.postMessage",
      body: { channel: "C123", text: "hello" },
    })
    const args = getCurlArgs()
    const dataIdx = args.indexOf("-d")
    expect(JSON.parse(args[dataIdx + 1])).toEqual({
      channel: "C123",
      text: "hello",
    })
  })

  it("passes string body as-is", async () => {
    mockCurl('{"ok":true}')
    await curlRequest({
      url: "https://slack.com/api/test",
      body: "token=xoxb-test" as any,
    })
    const args = getCurlArgs()
    const dataIdx = args.indexOf("-d")
    expect(args[dataIdx + 1]).toBe("token=xoxb-test")
  })

  it("uppercases HTTP method", async () => {
    mockCurl('{"ok":true}')
    await curlRequest({ url: "https://slack.com/api/test", method: "get" })
    const args = getCurlArgs()
    expect(args[args.indexOf("-X") + 1]).toBe("GET")
  })

  it("defaults to POST", async () => {
    mockCurl('{"ok":true}')
    await curlRequest({ url: "https://slack.com/api/test" })
    const args = getCurlArgs()
    expect(args[args.indexOf("-X") + 1]).toBe("POST")
  })

  it("uses custom timeout", async () => {
    mockCurl('{"ok":true}')
    await curlRequest({
      url: "https://slack.com/api/test",
      timeoutSeconds: 60,
    })
    const args = getCurlArgs()
    const timeoutIdx = args.indexOf("--max-time")
    expect(args[timeoutIdx + 1]).toBe("60")
  })

  it("includes stderr detail in error for DNS/TLS failures", async () => {
    mockCurlFailure(
      "Command failed",
      "curl: (6) Could not resolve host: slack.com"
    )
    await expect(
      curlRequest({ url: "https://slack.com/api/test" })
    ).rejects.toThrow("Could not resolve host: slack.com")
  })

  it("falls back to err.message when no stderr", async () => {
    mockCurlFailure("Command failed with exit code 7")
    await expect(
      curlRequest({ url: "https://slack.com/api/test" })
    ).rejects.toThrow("Command failed with exit code 7")
  })

  it("handles HTTP/1.1 100 Continue followed by real response", async () => {
    mockExecFile.mockImplementation((...allArgs: any[]) => {
      const cb = allArgs[2]
      if (typeof cb !== "function") return
      const raw =
        'HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 200 OK\r\ncontent-type: application/json\r\n\r\n{"ok":true}'
      cb(null, raw, "")
    })
    const result = await curlRequest({ url: "https://slack.com/api/test" })
    expect(result.status).toBe(200)
    expect(result.data).toEqual({ ok: true })
  })
})

describe("curlAxiosAdapter", () => {
  beforeEach(() => mockExecFile.mockReset())

  it("resolves absolute URLs directly (no double baseURL)", async () => {
    mockCurl('{"ok":true}')
    await curlAxiosAdapter({
      url: "https://slack.com/api/v1/auth.test",
      baseURL: "https://slack.com/api/",
      method: "POST",
    })
    const args = getCurlArgs()
    expect(args[args.length - 1]).toBe("https://slack.com/api/v1/auth.test")
  })

  it("prepends baseURL for relative URLs", async () => {
    mockCurl('{"ok":true}')
    await curlAxiosAdapter({
      url: "auth.test",
      baseURL: "https://slack.com/api/",
      method: "POST",
    })
    const args = getCurlArgs()
    expect(args[args.length - 1]).toBe("https://slack.com/api/auth.test")
  })

  it("handles undefined config.url with baseURL", async () => {
    mockCurl('{"ok":true}')
    await curlAxiosAdapter({
      url: undefined,
      baseURL: "https://slack.com/api/",
      method: "POST",
    })
    const args = getCurlArgs()
    expect(args[args.length - 1]).toBe("https://slack.com/api/")
  })

  it("includes request.path for WebClient compatibility", async () => {
    mockCurl('{"ok":true}')
    const result = await curlAxiosAdapter({
      url: "https://slack.com/api/chat.postMessage",
      method: "POST",
    })
    expect(result.request.path).toBe("/api/chat.postMessage")
  })

  it("handles malformed URL in request.path", async () => {
    mockCurl('{"ok":true}')
    const result = await curlAxiosAdapter({
      url: "not-a-url",
      method: "POST",
    })
    expect(result.request.path).toBe("not-a-url")
  })

  it("returns all fields required by @slack/web-api WebClient", async () => {
    mockCurl('{"ok":true}', 200)
    const config = { url: "https://slack.com/api/v1/auth.test", method: "POST" }
    const result = await curlAxiosAdapter(config)
    expect(result).toHaveProperty("data")
    expect(result).toHaveProperty("status")
    expect(result).toHaveProperty("statusText")
    expect(result).toHaveProperty("headers")
    expect(result).toHaveProperty("config")
    expect(result).toHaveProperty("request.path")
    expect(result.config).toBe(config)
  })

  it("does NOT reject on 4xx/5xx (WebClient uses validateStatus: () => true)", async () => {
    for (const status of [400, 401, 403, 404, 429, 500]) {
      mockCurl('{"ok":false,"error":"test"}', status)
      const result = await curlAxiosAdapter({
        url: "https://slack.com/api/test",
        method: "POST",
      })
      expect(result.status).toBe(status)
      expect(result.data.ok).toBe(false)
    }
  })

  it("passes response headers through (including Retry-After)", async () => {
    mockCurl('{"ok":false}', 429, { "Retry-After": "10" })
    const result = await curlAxiosAdapter({
      url: "https://slack.com/api/test",
      method: "POST",
    })
    expect(result.headers["retry-after"]).toBe("10")
  })
})
