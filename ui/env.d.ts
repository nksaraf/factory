/// <reference types="vite/client" />
import { EnvSchema, EnvNames, SettingsSchema } from "./app.settings.ts"
import { z } from "vinxi"

declare module "@vinxi/plugin-mdx" {
  const mdx = { default: any }
  export default mdx
}

declare module "@rio.js/env" {
  export interface RioEnv extends EnvSchema {}
}

declare module "@rio.js/os" {
  export interface RioEnv extends EnvSchema {}
  export interface RioSettings extends SettingsSchema {}

  export const env: RioEnv
}

declare module "*?pick=loader" {
  export const loader: LoaderFunction
}

declare global {
  interface ImportMeta {
    env: EnvSchema
  }
}
