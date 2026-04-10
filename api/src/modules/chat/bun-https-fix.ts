/**
 * Workaround for Bun's broken node:https TLS implementation.
 *
 * Bun polyfills node:https with its own socket layer which drops
 * connections to external HTTPS APIs (e.g. Slack). The Chat SDK's
 * @slack/web-api uses axios → node:https under the hood, so outbound
 * Slack API calls fail in Bun.
 *
 * This module monkey-patches @slack/web-api's WebClient to inject a
 * curl-based axios adapter for all outbound requests.
 *
 * MUST be imported before @chat-adapter/slack or any Chat SDK module.
 */
import { curlAxiosAdapter } from "../../lib/curl-http"

// Re-export for tests
export { curlAxiosAdapter as curlAdapter } from "../../lib/curl-http"

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
      this.axios.defaults.adapter = curlAxiosAdapter
      this._curlPatched = true
    }
    return origMakeRequest.call(this, url, body, headers)
  }
} catch {
  // @slack/web-api not available — nothing to patch
}
