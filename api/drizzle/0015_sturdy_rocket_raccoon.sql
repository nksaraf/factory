ALTER TABLE "infra"."realm_host" ADD CONSTRAINT "realm_host_realm_id_host_id_pk" PRIMARY KEY("realm_id","host_id");--> statement-breakpoint
ALTER TABLE "infra"."realm_host" REPLICA IDENTITY DEFAULT;--> statement-breakpoint
DROP INDEX "infra"."infra_realm_host_unique";
