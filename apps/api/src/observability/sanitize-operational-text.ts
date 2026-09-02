/** Prevent accidental credential or URL disclosure through free-form diagnostics. */
export function sanitizeOperationalText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "[REDACTED_URL]")
    .replace(/(?:postgres(?:ql)?|redis):\/\/\S+/gi, "[REDACTED_URL]")
    .replace(
      /\b(authorization|cookie|password|secret|token|api.?key|x-amz-signature|x-amz-credential)\b\s*[:=]\s*[^\s,;]+/gi,
      "$1=[REDACTED]",
    );
}
