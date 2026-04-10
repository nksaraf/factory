import { beforeEach, describe, expect, it, vi } from "vitest"

// Store mock fn at module scope so we can control it per-test
const mockExecFile = vi.fn<
  [
    string,
    string[],
    (err: Error | null, result: { stdout: string; stderr: string }) => void,
  ],
  void
>()

vi.mock("node:child_process", () => ({
  execFile: (...args: any[]) => mockExecFile(...(args as [any, any, any])),
}))

// Import AFTER mock setup
const { curlAdapter } = await import("./bun-https-fix")

function mockCurlResponse(body: string, statusCode = 200) {
  mockExecFile.mockImplementation((_cmd, _args, cb) => {
    cb(null, { stdout: `${body}\n${statusCode}`, stderr: "" })
  })
}

function mockCurlFailure(message: string, stderr = "") {
  mockExecFile.mockImplementation((_cmd, _args, cb) => {
    const err: any = new Error(message)
    err.stderr = stderr
    cb(err, { stdout: "", stderr })
  })
}

function getCurlArgs(): string[] {
  return mockExecFile.mock.calls[0][1]
}

describe("curlAdapter", () => {
  beforeEach(() => {
    mockExecFile.mockReset()
  })

  describe("URL construction", () => {
    it("uses absolute URL directly, not doubled with baseURL", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({
        url: "https://slack.com/api/auth.test",
        baseURL: "https://slack.com/api/",
        method: "POST",
      })
      const args = getCurlArgs()
      expect(args[args.length - 1]).toBe("https://slack.com/api/auth.test")
    })

    it("prepends baseURL for relative URLs", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({
        url: "auth.test",
        baseURL: "https://slack.com/api/",
        method: "POST",
      })
      const args = getCurlArgs()
      expect(args[args.length - 1]).toBe("https://slack.com/api/auth.test")
    })

    it("strips duplicate slashes between baseURL and relative URL", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({
        url: "/auth.test",
        baseURL: "https://slack.com/api/",
        method: "POST",
      })
      const args = getCurlArgs()
      expect(args[args.length - 1]).toBe("https://slack.com/api/auth.test")
    })

    it("uses raw URL when no baseURL provided", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({ url: "https://example.com/test", method: "GET" })
      const args = getCurlArgs()
      expect(args[args.length - 1]).toBe("https://example.com/test")
    })
  })

  describe("response parsing", () => {
    it("parses JSON body and extracts status code", async () => {
      mockCurlResponse('{"ok":true,"user":"bot"}', 200)
      const result = await curlAdapter({
        url: "https://slack.com/api/auth.test",
        method: "POST",
      })
      expect(result.data).toEqual({ ok: true, user: "bot" })
      expect(result.status).toBe(200)
      expect(result.statusText).toBe("OK")
    })

    it("returns non-JSON body as string", async () => {
      mockCurlResponse("plain text response", 200)
      const result = await curlAdapter({
        url: "https://example.com/text",
        method: "GET",
      })
      expect(result.data).toBe("plain text response")
    })

    it("maps known HTTP status codes to statusText", async () => {
      const cases: [number, string][] = [
        [200, "OK"],
        [201, "Created"],
        [400, "Bad Request"],
        [401, "Unauthorized"],
        [403, "Forbidden"],
        [404, "Not Found"],
        [429, "Too Many Requests"],
        [500, "Internal Server Error"],
      ]
      for (const [code, text] of cases) {
        mockCurlResponse('{"ok":false}', code)
        const result = await curlAdapter({
          url: "https://slack.com/api/test",
          method: "POST",
        })
        expect(result.status).toBe(code)
        expect(result.statusText).toBe(text)
      }
    })

    it("uses numeric string for unknown status codes", async () => {
      mockCurlResponse('{"ok":false}', 418)
      const result = await curlAdapter({
        url: "https://slack.com/api/test",
        method: "POST",
      })
      expect(result.statusText).toBe("418")
    })

    it("includes request.path for WebClient compatibility", async () => {
      mockCurlResponse('{"ok":true}')
      const result = await curlAdapter({
        url: "https://slack.com/api/chat.postMessage",
        method: "POST",
      })
      expect(result.request.path).toBe("/api/chat.postMessage")
    })

    it("handles malformed URL gracefully in request.path", async () => {
      mockCurlResponse('{"ok":true}')
      const result = await curlAdapter({
        url: "not-a-url",
        method: "POST",
      })
      expect(result.request.path).toBe("not-a-url")
    })
  })

  describe("request construction", () => {
    it("passes headers but filters Content-Length", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({
        url: "https://slack.com/api/test",
        method: "POST",
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
      mockCurlResponse('{"ok":true}')
      await curlAdapter({
        url: "https://slack.com/api/test",
        method: "POST",
        headers: { "X-Null": null, "X-Undef": undefined, "X-Valid": "yes" },
      })
      const args = getCurlArgs()
      expect(args.join(" ")).not.toContain("X-Null")
      expect(args.join(" ")).not.toContain("X-Undef")
      expect(args).toContain("X-Valid: yes")
    })

    it("serializes object body as JSON", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({
        url: "https://slack.com/api/chat.postMessage",
        method: "POST",
        data: { channel: "C123", text: "hello" },
      })
      const args = getCurlArgs()
      const dataIdx = args.indexOf("-d")
      expect(JSON.parse(args[dataIdx + 1])).toEqual({
        channel: "C123",
        text: "hello",
      })
    })

    it("passes string body as-is", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({
        url: "https://slack.com/api/test",
        method: "POST",
        data: "token=xoxb-test",
      })
      const args = getCurlArgs()
      const dataIdx = args.indexOf("-d")
      expect(args[dataIdx + 1]).toBe("token=xoxb-test")
    })

    it("omits -d flag when no body", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({ url: "https://slack.com/api/test", method: "GET" })
      expect(getCurlArgs()).not.toContain("-d")
    })

    it("uppercases HTTP method", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({ url: "https://slack.com/api/test", method: "get" })
      const args = getCurlArgs()
      expect(args[args.indexOf("-X") + 1]).toBe("GET")
    })

    it("defaults to POST", async () => {
      mockCurlResponse('{"ok":true}')
      await curlAdapter({ url: "https://slack.com/api/test" })
      const args = getCurlArgs()
      expect(args[args.indexOf("-X") + 1]).toBe("POST")
    })
  })

  describe("error handling", () => {
    it("includes stderr detail in error message for DNS/TLS failures", async () => {
      mockCurlFailure(
        "Command failed",
        "curl: (6) Could not resolve host: slack.com"
      )
      await expect(
        curlAdapter({ url: "https://slack.com/api/test", method: "POST" })
      ).rejects.toThrow("Could not resolve host: slack.com")
    })

    it("falls back to err.message when no stderr", async () => {
      mockCurlFailure("Command failed with exit code 7")
      await expect(
        curlAdapter({ url: "https://slack.com/api/test", method: "POST" })
      ).rejects.toThrow("Command failed with exit code 7")
    })
  })

  describe("axios response contract", () => {
    it("returns all fields required by @slack/web-api WebClient", async () => {
      mockCurlResponse('{"ok":true}', 200)
      const config = { url: "https://slack.com/api/auth.test", method: "POST" }
      const result = await curlAdapter(config)

      expect(result).toHaveProperty("data")
      expect(result).toHaveProperty("status")
      expect(result).toHaveProperty("statusText")
      expect(result).toHaveProperty("headers")
      expect(result).toHaveProperty("config")
      expect(result).toHaveProperty("request.path")
      expect(result.config).toBe(config)
    })

    it("does NOT reject on HTTP 4xx/5xx (WebClient uses validateStatus: () => true)", async () => {
      for (const status of [400, 401, 403, 404, 429, 500]) {
        mockCurlResponse(`{"ok":false,"error":"test_error"}`, status)
        const result = await curlAdapter({
          url: "https://slack.com/api/test",
          method: "POST",
        })
        expect(result.status).toBe(status)
        expect(result.data.ok).toBe(false)
      }
    })
  })
})
