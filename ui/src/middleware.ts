import { defineMiddleware, defineRequestMiddleware } from "vinxi/server"

import htmlPage from "../public/home-page.html?raw"

function hasSessionCookie(cookieHeader: string): boolean {
  return cookieHeader
    .split(";")
    .some((c) => c.trim().startsWith("better-auth.session_token="))
}

export default defineMiddleware({
  onRequest: defineRequestMiddleware(async (event) => {
    const pathname = event.node.req.url?.split("?")[0]

    if (pathname === "/") {
      const cookies = event.node.req.headers.cookie || ""

      if (!hasSessionCookie(cookies)) {
        event.node.res.setHeader("Content-Type", "text/html; charset=utf-8")
        event.node.res.setHeader(
          "Cache-Control",
          "public, max-age=3600, s-maxage=3600"
        )
        event.node.res.end(htmlPage)
        return
      }
    }
  }),
})
