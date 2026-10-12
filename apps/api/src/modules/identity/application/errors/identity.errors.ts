export class IdentityAuthorizationDeniedError extends Error {
  constructor() {
    super("authorization-denied");
    this.name = "IdentityAuthorizationDeniedError";
  }
}

export class IdentityStateConflictError extends Error {
  constructor() {
    super("identity-state-conflict");
    this.name = "IdentityStateConflictError";
  }
}

export class IdentityCursorInvalidError extends Error {
  constructor() {
    super("identity-cursor-invalid");
    this.name = "IdentityCursorInvalidError";
  }
}
