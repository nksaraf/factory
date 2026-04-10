-- Add iis, windows-service, process runtime types for infrastructure scanning
ALTER TABLE "infra"."runtime" DROP CONSTRAINT IF EXISTS "infra_runtime_type_valid";
ALTER TABLE "infra"."runtime" ADD CONSTRAINT "infra_runtime_type_valid"
  CHECK ("type" IN ('k8s-cluster', 'k8s-namespace', 'docker-engine', 'compose-project', 'systemd', 'reverse-proxy', 'iis', 'windows-service', 'process'));
