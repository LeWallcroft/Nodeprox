import type { ProblemDetails } from "@nodeprox/types";

interface AppErrorOptions {
  code: string;
  detail: string;
  errors?: readonly unknown[];
  statusCode: number;
  title: string;
  type: string;
}

export class AppError extends Error {
  readonly code: string;
  readonly errors: readonly unknown[] | undefined;
  readonly statusCode: number;
  readonly title: string;
  readonly type: string;

  constructor(options: AppErrorOptions) {
    super(options.detail);
    this.name = "AppError";
    this.code = options.code;
    this.errors = options.errors;
    this.statusCode = options.statusCode;
    this.title = options.title;
    this.type = options.type;
  }

  toProblemDetails(instance: string, requestId?: string): ProblemDetails {
    return {
      type: this.type,
      title: this.title,
      status: this.statusCode,
      detail: this.message,
      instance,
      code: this.code,
      ...(requestId ? { requestId } : {}),
      ...(this.errors ? { errors: this.errors } : {}),
    };
  }
}
