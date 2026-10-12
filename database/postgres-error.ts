export type PostgresFailure = {
  code: string;
  constraint?: string;
};

export class KnownPersistenceConflictError extends Error {
  constructor(
    readonly constraint: string,
    options?: { cause?: unknown },
  ) {
    super(`persistence-conflict:${constraint}`, options);
    this.name = "KnownPersistenceConflictError";
  }
}

export function knownPersistenceConflict(
  error: unknown,
  constraints: readonly string[],
): KnownPersistenceConflictError | null {
  const failure = findPostgresFailure(error);
  return failure?.code === "23505" &&
    failure.constraint !== undefined &&
    constraints.includes(failure.constraint)
    ? new KnownPersistenceConflictError(failure.constraint, { cause: error })
    : null;
}

export function findPostgresFailure(
  error: unknown,
  maxDepth = 8,
): PostgresFailure | null {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (typeof current !== "object" || current === null || seen.has(current))
      return null;
    seen.add(current);
    const candidate = current as Record<string, unknown>;
    if (
      typeof candidate.code === "string" &&
      /^[0-9A-Z]{5}$/.test(candidate.code)
    ) {
      const constraint = candidate.constraint ?? candidate.constraint_name;
      return {
        code: candidate.code,
        ...(typeof constraint === "string" ? { constraint } : {}),
      };
    }
    current = candidate.cause;
  }
  return null;
}

export function isPostgresCode(error: unknown, ...codes: string[]): boolean {
  const failure = findPostgresFailure(error);
  return failure !== null && codes.includes(failure.code);
}

export function isUniqueConstraint(
  error: unknown,
  constraints?: readonly string[],
): boolean {
  const failure = findPostgresFailure(error);
  return (
    failure?.code === "23505" &&
    (constraints === undefined ||
      (failure.constraint !== undefined &&
        constraints.includes(failure.constraint)))
  );
}
