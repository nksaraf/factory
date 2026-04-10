export type {
  ScanResult,
  ScanReverseProxy,
  ScanRouter,
  CollectorStatus,
} from "./types.js"
export { collectLocal } from "./collectors/local.js"
export { collectRemote } from "./collectors/remote.js"
export {
  collectTraefikRoutes,
  detectTraefikApiUrl,
} from "./collectors/traefik.js"
