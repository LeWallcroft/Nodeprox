/** Prevent credentials and signed URLs from leaking through operational logs. */
export function sanitizeOperationalText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/(?:postgres(?:ql)?|redis):\/\/\S+/gi, "[REDACTED_URL]")
    .replace(
      /\b(database.?url|authorization|cookie|password|secret|token|api.?key|x-amz-signature|x-amz-credential)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
}

export function fatalDiagnostic(error: unknown): {
  errorName: string;
  errorMessage: string;
} {
  const isError = error instanceof Error;
  const errorName = isError ? error.name : typeof error;
  let errorMessage: string;
  if (isError) errorMessage = error.message;
  else if (typeof error === "string") errorMessage = error;
  else {
    try {
      errorMessage = String(error);
    } catch {
      errorMessage = "Unknown fatal value";
    }
  }
  return {
    errorName: sanitizeOperationalText(errorName).slice(0, 80),
    errorMessage: sanitizeOperationalText(errorMessage).slice(0, 512),
  };
}
