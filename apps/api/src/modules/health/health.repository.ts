import type { HealthStatus } from "@nodeprox/types";

export class HealthRepository {
  getStatus(): HealthStatus {
    return "ok";
  }
}
