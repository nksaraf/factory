-- 0012_tunnel_mode_tcp_port.sql
-- Add mode and tcp_port columns to tunnel table for TCP tunneling

ALTER TABLE "factory_fleet"."tunnel"
  ADD COLUMN "mode" text NOT NULL DEFAULT 'http';--> statement-breakpoint
ALTER TABLE "factory_fleet"."tunnel"
  ADD COLUMN "tcp_port" integer;--> statement-breakpoint
ALTER TABLE "factory_fleet"."tunnel"
  ADD CONSTRAINT "tunnel_mode_valid" CHECK ("mode" IN ('http', 'tcp'));
