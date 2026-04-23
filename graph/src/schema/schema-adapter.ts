import type { JsonSchema } from "./types"

export interface ValidationResult {
  success: boolean
  errors?: Array<{ path: string; message: string }>
}

export interface SchemaAdapter {
  /** Convert a schema object to JSON Schema */
  toJsonSchema(schema: unknown): JsonSchema
  /** Validate data against a schema */
  validate(schema: unknown, data: unknown): ValidationResult
}

// --- Zod adapter ---
export function createZodAdapter(): SchemaAdapter {
  return {
    toJsonSchema(schema: unknown): JsonSchema {
      if (schema && typeof schema === "object" && "_def" in schema) {
        return zodSchemaToJsonSchema(schema)
      }
      throw new Error("Not a Zod schema")
    },
    validate(schema: unknown, data: unknown): ValidationResult {
      const z = schema as any
      const result = z.safeParse(data)
      if (result.success) return { success: true }
      return {
        success: false,
        errors: result.error.issues.map((i: any) => ({
          path: i.path.join("."),
          message: i.message,
        })),
      }
    },
  }
}

function zodSchemaToJsonSchema(schema: any): JsonSchema {
  const def = schema._def
  switch (def.typeName) {
    case "ZodString":
      return { type: "string" }
    case "ZodNumber":
      return { type: "number" }
    case "ZodBoolean":
      return { type: "boolean" }
    case "ZodEnum":
      return { type: "string", enum: def.values }
    case "ZodArray":
      return { type: "array", items: zodSchemaToJsonSchema(def.type) }
    case "ZodObject": {
      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []
      for (const [key, value] of Object.entries(def.shape())) {
        const v = value as any
        properties[key] = zodSchemaToJsonSchema(v)
        if (!v.isOptional()) required.push(key)
      }
      return {
        type: "object",
        properties,
        ...(required.length ? { required } : {}),
      }
    }
    case "ZodOptional":
      return zodSchemaToJsonSchema(def.innerType)
    case "ZodDefault":
      return {
        ...zodSchemaToJsonSchema(def.innerType),
        default: def.defaultValue(),
      }
    case "ZodLiteral":
      return { const: def.value }
    case "ZodUnion":
      return { anyOf: def.options.map(zodSchemaToJsonSchema) }
    case "ZodNullable": {
      const inner = zodSchemaToJsonSchema(def.innerType)
      return { anyOf: [inner, { type: "null" }] }
    }
    default:
      return {} // unknown type - pass through as empty schema
  }
}

// --- Raw JSON Schema adapter ---
export function createRawAdapter(): SchemaAdapter {
  return {
    toJsonSchema(schema: unknown): JsonSchema {
      if (
        schema &&
        typeof schema === "object" &&
        ("type" in schema || "$schema" in schema || "properties" in schema)
      ) {
        return schema as JsonSchema
      }
      throw new Error("Not a valid JSON Schema object")
    },
    validate(_schema: unknown, _data: unknown): ValidationResult {
      // Raw adapter doesn't validate - that's the consumer's job
      return { success: true }
    },
  }
}

// --- Auto-detect adapter ---
export function detectAdapter(schema: unknown): SchemaAdapter {
  if (schema && typeof schema === "object") {
    if ("_def" in schema) return createZodAdapter()
    if ("type" in schema || "$schema" in schema || "properties" in schema)
      return createRawAdapter()
  }
  throw new Error(`Cannot detect schema type for: ${typeof schema}`)
}
