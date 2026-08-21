export type HealthStatus = "ok";

export interface RequestContext {
  requestId: string;
  userId?: string;
  sessionId?: string;
}

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  code?: string;
  requestId?: string;
  errors?: readonly unknown[];
}
