import { homedir, platform } from "node:os"
import { join } from "node:path"

const home = homedir()
const os = platform()

function resolveConfig(): string {
  if (os === "darwin") {
    return join(home, "Library", "Application Support", "dx")
  }
  if (os === "win32") {
    const appData = process.env.APPDATA
    return join(appData ?? join(home, "AppData", "Roaming"), "dx")
  }
  const xdg = process.env.XDG_CONFIG_HOME
  return join(xdg ?? join(home, ".config"), "dx")
}

function resolveData(): string {
  if (os === "darwin") {
    return join(home, "Library", "Application Support", "dx", "data")
  }
  if (os === "win32") {
    const localAppData = process.env.LOCALAPPDATA
    return join(localAppData ?? join(home, "AppData", "Local"), "dx")
  }
  const xdg = process.env.XDG_DATA_HOME
  return join(xdg ?? join(home, ".local", "share"), "dx")
}

function resolveCache(): string {
  if (os === "darwin") {
    return join(home, "Library", "Caches", "dx")
  }
  if (os === "win32") {
    const localAppData = process.env.LOCALAPPDATA
    return join(localAppData ?? join(home, "AppData", "Local"), "dx", "cache")
  }
  const xdg = process.env.XDG_CACHE_HOME
  return join(xdg ?? join(home, ".cache"), "dx")
}

export const DX_CONFIG_DIR = resolveConfig()
export const DX_DATA_DIR = resolveData()
export const DX_CACHE_DIR = resolveCache()
