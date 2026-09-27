import type { ChapterAuthorizationFailureCode } from "../chapter-authorization-result.js";

export interface ChapterAuthorizationFailureReporter {
  report(input: {
    code: ChapterAuthorizationFailureCode;
    operation: string;
    actorId?: string;
    requestId?: string;
    permission?: string;
    resourceType?: string;
    resourceId?: string;
    error?: unknown;
  }): void;
}
