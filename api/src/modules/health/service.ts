export abstract class HealthService {
  static status() {
    return { status: "ok" as const, service: "factory-api" as const }
  }
}
