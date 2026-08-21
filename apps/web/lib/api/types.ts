export interface ApiRequestOptions extends RequestInit {
  headers?: HeadersInit;
}

export interface AuthenticatedUserView {
  id: string;
  email: string;
  status?: string;
}

export interface SessionView {
  user: AuthenticatedUserView;
  session: { id: string };
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
