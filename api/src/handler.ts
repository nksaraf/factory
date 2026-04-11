import { appendHeaders, defineEventHandler, toWebRequest } from "vinxi/http"

import { createServer } from "./server"

const appPromise = globalThis._appPromise ?? createServer()

export default defineEventHandler(async (event) => {
  const app = await appPromise
  const request = toWebRequest(event)
  const response = await app.fetch(request)

  appendHeaders(event, {
    "Access-Control-Allow-Credentials": "true",
  })
  return response
})
