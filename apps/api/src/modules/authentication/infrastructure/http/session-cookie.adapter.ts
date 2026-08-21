import type { FastifyReply, FastifyRequest } from "fastify";

const COOKIE_NAME = "nodeprox_session";
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60;

export class SessionCookieAdapter {
  constructor(private readonly secure: boolean) {}

  read(request: FastifyRequest): string | null {
    const header = request.headers.cookie ?? "";
    const value = header
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${COOKIE_NAME}=`));
    return value
      ? decodeURIComponent(value.slice(COOKIE_NAME.length + 1))
      : null;
  }

  set(reply: FastifyReply, token: string): void {
    reply.header(
      "set-cookie",
      [
        `${COOKIE_NAME}=${encodeURIComponent(token)}`,
        ...this.attributes(COOKIE_MAX_AGE),
      ].join("; "),
    );
  }

  private attributes(maxAge: number): string[] {
    const attributes = [
      "Path=/",
      "HttpOnly",
      "SameSite=Lax",
      `Max-Age=${maxAge}`,
    ];
    if (this.secure) attributes.push("Secure");
    return attributes;
  }

  clear(reply: FastifyReply): void {
    reply.header(
      "set-cookie",
      [`${COOKIE_NAME}=`, ...this.attributes(0)].join("; "),
    );
  }
}
