import type { HealthRepository } from "./health.repository.js";

export class HealthService {
  constructor(private readonly repository: HealthRepository) {}

  getStatus() {
    return { status: this.repository.getStatus() };
  }
}
