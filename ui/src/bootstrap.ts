import { RioClient, RioMolecule } from "@rio.js/client"
import { CommandService } from "@rio.js/uikit/lib/command"
import { PanelService } from "@rio.js/uikit/lib/panel"

import __buffer_polyfill from "../node_modules/vite-plugin-node-polyfills/shims/buffer/dist/index.js"
import __global_polyfill from "../node_modules/vite-plugin-node-polyfills/shims/global/dist/index.js"
import __process_polyfill from "../node_modules/vite-plugin-node-polyfills/shims/process/dist/index.js"
import { rio } from "./lib/rio"

/**
 * App Bootstrap — Core Service Registration
 *
 * This file is imported by entry.client.tsx BEFORE the React app renders.
 * It registers foundational Rio.js services that the rest of the app depends on.
 *
 * Initialization Sequence:
 * 1. entry.client.tsx imports this file (side-effect: services registered)
 * 2. This file registers: commands, panels, logging, UI/theme (UIService)
 * 3. entry.client.tsx then registers extensions (trafficure.core, gis.core, etc.)
 * 4. entry.client.tsx creates the enterprise auth client and registers it
 * 5. Extensions are enabled, routes are collected, and the React router is created
 * 6. React app renders with all providers (Auth, Theme, Tooltip, etc.)
 *
 * Services registered here:
 * - "commands" (CommandService) — keyboard shortcut / command palette
 * - "panel" (PanelService) — panel/drawer management
 * - "log" — console logging facade
 * - "dom" (UIService) — theme mode (light/dark/system) and hue, persisted to localStorage
 */

// Devtools: patch globalThis.RIO_ENV with stored overrides BEFORE EnvService reads it
if (import.meta.env.DEV) {
  const overrides = localStorage.getItem("devtools:env-overrides")
  if (overrides) {
    try {
      if (!localStorage.getItem("devtools:env-originals")) {
        localStorage.setItem(
          "devtools:env-originals",
          JSON.stringify(globalThis.RIO_ENV)
        )
      }
      Object.assign(globalThis.RIO_ENV, JSON.parse(overrides))
    } catch {}
  }
}

// import "./tracing"
globalThis.Buffer = globalThis.Buffer || __buffer_polyfill

globalThis.global = globalThis.global || __global_polyfill

globalThis.process = globalThis.process || __process_polyfill

class UIService extends RioMolecule {
  // _isPending = this.atom(false, { name: "isPending" })
  // _openScreen = this.atom(null as RioScreen | null, {
  //   name: "openScreen",
  // })
  _hue = this.atom("", { name: "hue", persist: true })
  _mode = this.atom("system" as "system" | "light" | "dark", {
    name: "mode",
    persist: true,
  })

  constructor(public rio: RioClient) {
    super(rio, {
      name: "DOM",
      id: "dom",
    })

    document.documentElement.className = `${this._mode.value} hue-${this._hue.value} antialiased`

    this.rio.reactor.subscribe([this._hue, this._mode], () => {
      document.documentElement.className = `${this._mode.value} hue-${this._hue.value} antialiased`
    })

    this.rio.reactor.subscribe([this._mode], () => {
      // Store theme based on current route
      const isProjectRoute = window.location.pathname.includes("/project/")
      const storageKey = isProjectRoute
        ? "rio:color-mode"
        : "rio:color-mode-global"
      localStorage.setItem(storageKey, this._mode.value)
    })

    // Load theme based on current route
    const isProjectRoute = window.location.pathname.includes("/project/")
    const storageKey = isProjectRoute
      ? "rio:color-mode"
      : "rio:color-mode-global"
    this._mode.value = localStorage.getItem(storageKey) ?? "light"
  }

  // set isPending(val) {
  //   this._isPending.value = val
  // }

  // get isPending() {
  //   return this._isPending.value
  // }

  set hue(val: string) {
    this._hue.value = val
  }

  get hue() {
    return this._hue.value!
  }

  set mode(val: "system" | "light" | "dark") {
    this._mode.value = val
  }

  get mode() {
    return this._mode.value!
  }

  // _startTransition: TransitionStartFunction | null = null

  // startTransition(fn) {
  //   let start = this._startTransition ?? startTransition
  //   return start(fn)
  // }

  // render(element: HTMLElement) {
  //   const renderer = new RioScreen(this.rio)
  //   renderer.mount(element)
  //   this._openScreen.value = renderer

  //   this.rio.events.on(
  //     "input-required",
  //     async ({ controller, prompt: promptMessage, schema }) => {
  //       let input = prompt(promptMessage)
  //       controller.resolve(input)
  //     },
  //   )

  //   return renderer
  // }
}

const commandService = new CommandService(rio)
commandService.setBaseContext({
  rio,
})
const panelService = new PanelService(rio)
rio.services.registerSync("panel", panelService)
rio.services.registerSync("commands", commandService)
rio.services.registerSync("log", {
  info: console.info.bind(console),
  error: console.error.bind(console),
  warn: console.warn.bind(console),
  debug: console.debug.bind(console),
})
rio.services.registerSync("dom", new UIService(rio))

console.log("bootstrap", rio.services.get("commands"))

globalThis.rio = rio
