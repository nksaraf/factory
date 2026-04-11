import {
  type Simplify,
  type ToEnvSchema,
  type ToEnvVariables,
  createEnvSchema,
  z,
} from "@rio.js/env/utils"

export const settingsSchema = z.object({
  PUBLIC: z.object({
    AUTH_URL: z.string().default("http://localhost:3001"),
    FACTORY_API_URL: z.string().default("http://localhost:3000/api/v1/factory"),
    SUPABASE_URL: z.string().default(""),
    SUPABASE_ANON_KEY: z.string().default(""),

    // PowerSync — realtime data sync
    POWERSYNC_URL: z.string().default("http://localhost:8090"),
    ENABLE_POWERSYNC: z.string().default("false"),

    // Feature flags
    ENABLE_ANALYTICS: z.string().default("false"),
    ENABLE_REPORTS: z.string().default("false"),
    ENABLE_COMPARE_TOOL: z.string().default("false"),

    // Trafficure
    TRAFFICURE_API_BASE_URL: z.string().default(""),
    TRAFFICURE_MAPBOX_TOKEN: z.string().default(""),

    // Smart Market
    SMART_FLOW_URL: z.string().default(""),
  }),
  PRIVATE: z.object({
    DATABASE_URL: z.string().default(""),
  }),
})

export type SettingsSchema = z.infer<typeof settingsSchema>
export type EnvVariables = Simplify<ToEnvVariables<SettingsSchema>>
export type EnvSchema = ToEnvSchema<EnvVariables>
export type EnvNames = keyof EnvSchema
export const envSchema = createEnvSchema<EnvSchema>(settingsSchema)
