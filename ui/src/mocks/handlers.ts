import { HttpResponse, http } from "msw"

import { workspaceHandlers } from "./workspace-handlers"

export const handlers = [
  http.get("/user", () => {
    return HttpResponse.json({ name: "John Maverick" })
  }),
  ...workspaceHandlers,
]
