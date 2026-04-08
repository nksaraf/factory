import { Elysia } from "elysia"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// import.meta.dir = api/src/modules/install, go up 4 levels to repo root
const scriptPath = resolve(import.meta.dir, "..", "..", "..", "..", "scripts", "install.sh")
const installScript = readFileSync(scriptPath, "utf-8")

export const installController = new Elysia().get("/install", () => {
  return new Response(installScript, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  })
})
