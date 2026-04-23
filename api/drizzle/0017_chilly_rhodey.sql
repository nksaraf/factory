CREATE SCHEMA "graph";
--> statement-breakpoint
CREATE TABLE "graph"."action_type" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"name" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb,
	"precondition" jsonb,
	"effect" jsonb NOT NULL,
	"side_effects" jsonb,
	"annotations" jsonb,
	"access" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "action_type_pk" PRIMARY KEY("graph_id","target_kind","name")
);
--> statement-breakpoint
CREATE TABLE "graph"."extension" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"property_name" text NOT NULL,
	"schema" jsonb NOT NULL,
	"annotations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_graph_target_property" PRIMARY KEY("graph_id","target_kind","property_name")
);
--> statement-breakpoint
CREATE TABLE "graph"."extension_value" (
	"graph_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"property_name" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "extension_value_pk" PRIMARY KEY("graph_id","target_kind","target_id","property_name")
);
--> statement-breakpoint
CREATE TABLE "graph"."function_type" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"name" text NOT NULL,
	"input_schema" jsonb NOT NULL,
	"output_schema" jsonb NOT NULL,
	"body" jsonb NOT NULL,
	"kind" text NOT NULL,
	"annotations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "function_type_pk" PRIMARY KEY("graph_id","target_kind","name")
);
--> statement-breakpoint
CREATE TABLE "graph"."instance" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"kind" text NOT NULL,
	"slug" text,
	"title" text,
	"spec" jsonb NOT NULL,
	"status" jsonb,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "graph"."interface_type" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"name" text NOT NULL,
	"properties_schema" jsonb NOT NULL,
	"annotations" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "interface_type_graph_name" PRIMARY KEY("graph_id","name")
);
--> statement-breakpoint
CREATE TABLE "graph"."link" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"link_type_name" text NOT NULL,
	"source_kind" text NOT NULL,
	"source_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"properties" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph"."link_type" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"name" text NOT NULL,
	"source_kind" text NOT NULL,
	"target_kind" text NOT NULL,
	"cardinality" text NOT NULL,
	"inverse_name" text,
	"properties_schema" jsonb,
	"annotations" jsonb,
	"access" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "link_type_graph_name" PRIMARY KEY("graph_id","name")
);
--> statement-breakpoint
CREATE TABLE "graph"."materialized_derived" (
	"graph_id" text NOT NULL,
	"target_kind" text NOT NULL,
	"target_id" text NOT NULL,
	"property_name" text NOT NULL,
	"value" jsonb,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stale" boolean DEFAULT false NOT NULL,
	CONSTRAINT "materialized_derived_pk" PRIMARY KEY("graph_id","target_kind","target_id","property_name")
);
--> statement-breakpoint
CREATE TABLE "graph"."object_type" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"kind" text NOT NULL,
	"extends_kind" text,
	"spec_schema" jsonb NOT NULL,
	"status_schema" jsonb,
	"annotations" jsonb,
	"implements" jsonb,
	"traits" jsonb,
	"access" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "object_type_graph_kind" PRIMARY KEY("graph_id","kind")
);
--> statement-breakpoint
CREATE TABLE "graph"."registry" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" text NOT NULL,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "registry_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "graph"."shared_property" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"name" text NOT NULL,
	"schema" jsonb NOT NULL,
	"annotations" jsonb,
	"display" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shared_property_graph_name" PRIMARY KEY("graph_id","name")
);
--> statement-breakpoint
CREATE TABLE "graph"."struct_type" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"name" text NOT NULL,
	"fields_schema" jsonb NOT NULL,
	"main_field" text,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "struct_type_graph_name" PRIMARY KEY("graph_id","name")
);
--> statement-breakpoint
CREATE TABLE "graph"."ui_override" (
	"graph_id" text NOT NULL,
	"kind" text NOT NULL,
	"view_kind" text NOT NULL,
	"code" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ui_override_pk" PRIMARY KEY("graph_id","kind","view_kind")
);
--> statement-breakpoint
CREATE TABLE "graph"."value_type" (
	"id" text PRIMARY KEY NOT NULL,
	"graph_id" text NOT NULL,
	"name" text NOT NULL,
	"base" text NOT NULL,
	"description" text,
	"display" jsonb,
	"validation" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "value_type_graph_name" PRIMARY KEY("graph_id","name")
);
--> statement-breakpoint
ALTER TABLE "graph"."action_type" ADD CONSTRAINT "action_type_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."extension" ADD CONSTRAINT "extension_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."function_type" ADD CONSTRAINT "function_type_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."instance" ADD CONSTRAINT "instance_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."interface_type" ADD CONSTRAINT "interface_type_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."link" ADD CONSTRAINT "link_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."link_type" ADD CONSTRAINT "link_type_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."object_type" ADD CONSTRAINT "object_type_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."shared_property" ADD CONSTRAINT "shared_property_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."struct_type" ADD CONSTRAINT "struct_type_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph"."value_type" ADD CONSTRAINT "value_type_graph_id_registry_id_fk" FOREIGN KEY ("graph_id") REFERENCES "graph"."registry"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "instance_graph_kind_idx" ON "graph"."instance" USING btree ("graph_id","kind");--> statement-breakpoint
CREATE INDEX "instance_slug_idx" ON "graph"."instance" USING btree ("graph_id","kind","slug");--> statement-breakpoint
CREATE INDEX "link_source_idx" ON "graph"."link" USING btree ("graph_id","source_kind","source_id","link_type_name");--> statement-breakpoint
CREATE INDEX "link_target_idx" ON "graph"."link" USING btree ("graph_id","target_kind","target_id");--> statement-breakpoint
CREATE INDEX "link_type_idx" ON "graph"."link" USING btree ("graph_id","link_type_name");--> statement-breakpoint
CREATE INDEX "link_type_source_idx" ON "graph"."link_type" USING btree ("graph_id","source_kind");