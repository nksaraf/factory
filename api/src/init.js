import { FactoryAPI } from "./factory.api"

/** Vinxi plugin: run migrations at startup. */
export default async function () {
  const service = await FactoryAPI.create()
  await service.setupDb()
}
