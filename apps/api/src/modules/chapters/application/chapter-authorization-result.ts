import type { AuthorizationFailureCode } from "../../authorization/application/authorization-result.js";

export type ChapterAuthorizationFailureCode =
  | "chapter-read-failed"
  | "series-owner-evaluation-failed"
  | "series-assignment-evaluation-failed"
  | "helper-permission-evaluation-failed";

export type ChapterTechnicalFailure = {
  allowed: false;
  reason: "authorization-unavailable";
  failureCode: ChapterAuthorizationFailureCode | AuthorizationFailureCode;
};
