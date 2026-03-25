import { t, type UnwrapSchema } from "elysia"

export const ProductModel = {
  moduleNameParams: t.Object({ name: t.String() }),
  registerModuleBody: t.Object({
    name: t.String(),
    team: t.String(),
    product: t.Optional(t.String()),
  }),
  createWorkItemBody: t.Object({
    title: t.String(),
    moduleId: t.Optional(t.String()),
    status: t.Optional(t.String()),
  }),
  workItemIdParams: t.Object({ id: t.String() }),
  updateWorkItemBody: t.Object({
    title: t.Optional(t.String()),
    status: t.Optional(t.String()),
    assignee: t.Optional(t.String()),
  }),
} as const

export type ProductModels = {
  [K in keyof typeof ProductModel]: UnwrapSchema<(typeof ProductModel)[K]>
}
