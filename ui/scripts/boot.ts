import { RioClient } from "@rio.js/client"

const rio = new RioClient()

export async function boot() {
  await installRioEngine()
  return rio
}

async function installRioEngine() {
  console.log(rio.env)
}

export { rio }
