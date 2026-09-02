import type { ProblemCategory } from "@nodeprox/types";

/**
 * The canonical category mapping for RFC 9457 responses. Callers keep their
 * stable machine-readable `code`; clients must never infer meaning from text.
 */
export function problemCategoryForStatus(statusCode: number): ProblemCategory {
  if (statusCode === 401) return "authentication";
  if (statusCode === 403) return "authorization";
  if (statusCode === 404) return "not_found";
  if (statusCode === 409) return "conflict";
  if (statusCode === 429) return "rate_limit";
  if (statusCode === 502 || statusCode === 503) return "external_dependency";
  if (statusCode === 400 || statusCode === 413 || statusCode === 415)
    return "validation";
  if (statusCode === 422) return "business_rule";
  return "internal";
}

export const PROBLEM_CODES = {
  CHAPTER_CONFLICT: "chapter-conflict",
  FORBIDDEN: "authorization-denied",
  INTERNAL: "internal-error",
} as const;
