-- Add via_kind and via_id to network_link for middlebox/carrier tracking.
-- Nullable — only set for link types where a distinct intermediary is operationally
-- significant (e.g. nat: firewall, cdn-forward: CDN estate, tunnel: VPN gateway).
ALTER TABLE "infra"."network_link" ADD COLUMN "via_kind" text;--> statement-breakpoint
ALTER TABLE "infra"."network_link" ADD COLUMN "via_id" text;
