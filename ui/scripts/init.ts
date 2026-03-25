import { readFile } from "fs/promises"

import { initializeGraph } from "@rio.js/enterprise"
import { drizzle, schema } from "@rio.js/enterprise/db"
import { migrate, migrationsDir } from "@rio.js/enterprise/migrator"
import { AuthzedSyncClient } from "@rio.js/enterprise/plugins"
import { env } from "@rio.js/env"

const enterpriseDB = drizzle(
  env.PRIVATE_DATABASE_URL! + "?options=-c search_path=enterprise",
  { schema: schema }
)

console.log(env)
const schemaText = await readFile("./src/auth-schema.zed", "utf-8")
const authzedClient = new AuthzedSyncClient({
  token: env.PRIVATE_AUTHZED_TOKEN!,
  endpoint: env.PRIVATE_AUTHZED_ENDPOINT!,
})

await authzedClient.writeSchema(schemaText)
await initializeGraph(authzedClient)

await migrate(enterpriseDB, {
  migrationsFolder: migrationsDir,
  migrationsSchema: "enterprise",
  migrationsTable: "_migrations",
})
// db.insert(t.platform_role).values({
// 	role: "platform_admin",
// 	name: "Platform Admin",
// 	description: "Platform Admin",
// 	metadata: {},
// });

// await authzedClient.syncRelationshipsBatch([
// 	{
// 		objectId: "platform_admin",
// 		objectType: "platform_role",
// 		relationshipType: "platform",
// 		subjectId: "default",
// 		subjectType: "platform",
// 		operation: "touch",
// 	},
// 	{
// 		objectId: "default",
// 		objectType: "platform",
// 		relationshipType: "org_administrator",
// 		subjectId: "platform_admin",
// 		subjectType: "platform_role",
// 		optionalRelation: "member",
// 		operation: "touch",
// 	},
// 	{
// 		objectId: "default",
// 		objectType: "platform",
// 		relationshipType: "role_manager",
// 		subjectId: "platform_admin",
// 		subjectType: "platform_role",
// 		optionalRelation: "member",
// 		operation: "touch",
// 	},
// 	{
// 		objectId: "default",
// 		objectType: "platform",
// 		relationshipType: "user_administrator",
// 		subjectId: "platform_admin",
// 		subjectType: "platform_role",
// 		optionalRelation: "member",
// 		operation: "touch",
// 	},
// ]);

// try {
// 	if (
// 		!(await db.query.user.findFirst({
// 			where: eq(t.user.id, "usr_000000000000000000000000"),
// 		}))
// 	) {
// 		await db.insert(t.user).values({
// 			id: "usr_000000000000000000000000",
// 			email: "admin@rio.software",
// 			name: "Admin",
// 			platformRole: "platform_admin",
// 			emailVerified: true,
// 		});
// 		await db.insert(t.account).values({
// 			accountId: "usr_000000000000000000000000",
// 			userId: "usr_000000000000000000000000",
// 			providerId: "credential",
// 			id: "acc_000000000000000000000000",
// 			password: await hashPassword("lepton@123"),
// 			createdAt: new Date(),
// 			updatedAt: new Date(),
// 		});
// 	}

// 	await authzedClient.syncRelationshipsBatch([
// 		{
// 			objectId: "default",
// 			objectType: "platform",
// 			relationshipType: "user",
// 			subjectId: "usr_000000000000000000000000",
// 			subjectType: "user",
// 			operation: "touch",
// 		},
// 		{
// 			objectId: "platform_admin",
// 			objectType: "platform_role",
// 			relationshipType: "has_role",
// 			subjectId: "usr_000000000000000000000000",
// 			subjectType: "user",
// 			operation: "touch",
// 		},
// 	]);
// } catch (error) {
// 	console.error(error);
// }

// const { headers } = await auth.api.signInEmail({
//   body: {
//     email: "admin@rio.software",
//     password: "lepton@123",
//   },
//   returnHeaders: true,
// })

// const cookie = headers.get("set-cookie")
// if (!cookie) {
//   throw new Error("No cookie found")
// }
