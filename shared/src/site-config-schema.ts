import { z } from "zod"

export const siteConfigSchema = z.object({
  role: z.enum(["site", "factory"]).default("site"),

  site: z.object({
    name: z.string().min(1),
    domain: z.string().min(1),
  }),

  admin: z.object({
    email: z.string().email(),
  }),

  tls: z
    .object({
      mode: z
        .enum(["letsencrypt", "self-signed", "provided"])
        .default("self-signed"),
      certPath: z.string().optional(),
      keyPath: z.string().optional(),
    })
    .default({}),

  database: z
    .object({
      mode: z.enum(["embedded", "external"]).default("embedded"),
      url: z.string().optional(),
    })
    .default({})
    .refine((db) => db.mode !== "external" || (db.url && db.url.length > 0), {
      message: "database.url is required when database.mode is 'external'",
    }),

  registry: z
    .object({
      mode: z.enum(["embedded", "external"]).default("embedded"),
      url: z.string().optional(),
    })
    .default({}),

  resources: z
    .object({
      profile: z.enum(["small", "medium", "large"]).default("small"),
    })
    .default({}),

  network: z
    .object({
      podCidr: z.string().default("10.42.0.0/16"),
      serviceCidr: z.string().default("10.43.0.0/16"),
    })
    .default({}),

  install: z
    .object({
      mode: z.enum(["connected", "offline"]).default("connected"),
      factoryUrl: z.string().default(""),
    })
    .default({}),
})

export type SiteConfig = z.infer<typeof siteConfigSchema>
