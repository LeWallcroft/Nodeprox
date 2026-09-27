import type { AuthorizationFailureCode } from "../authorization-result.js";

export interface AuthorizationFailureReporter {
  report(input: {
    code: AuthorizationFailureCode;
    operation: string;
    actorId?: string;
    requestId?: string;
    permission?: string;
    resourceType?: string;
    resourceId?: string;
    error?: unknown;
  }): void;
}
