export class AuthenticationRejectedError extends Error {
  constructor(readonly code: "invalid-credentials" | "account-pending") {
    super(code);
    this.name = "AuthenticationRejectedError";
  }
}
