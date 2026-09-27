import type { AuthorizationDecision } from "../domain/authorization.types.js";

export type AuthorizationFailureCode =
  | "role-lookup-failed"
  | "resource-evaluation-failed"
  | "policy-evaluation-failed"
  | "helper-cooldown-read-failed"
  | "helper-cooldown-invalid";

export type AuthorizationTechnicalFailure = {
  allowed: false;
  reason: "authorization-unavailable";
  failureCode: AuthorizationFailureCode;
};

export type AuthorizationResult =
  | AuthorizationDecision
  | AuthorizationTechnicalFailure;
