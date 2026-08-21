import type { z } from "zod";
import { AppError } from "../errors/app-error.js";

export function parseWithSchema<TSchema extends z.ZodType>(
  schema: TSchema,
  input: unknown,
): z.infer<TSchema> {
  const result = schema.safeParse(input);

  if (!result.success) {
    throw new AppError({
      code: "validation-error",
      detail: "The request did not pass validation.",
      statusCode: 400,
      title: "Request validation failed",
      type: "https://nodeprox.dev/problems/validation-error",
      errors: result.error.issues,
    });
  }

  return result.data;
}
