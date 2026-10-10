import { isAllowedProxyRoute } from "../../../lib/api/proxy-allowlist";

const BACKEND_API_ORIGIN =
  process.env.NODEPROX_API_URL ?? "http://localhost:3001";
const FORWARDED_REQUEST_HEADERS = [
  "accept",
  "content-type",
  "cookie",
  "user-agent",
] as const;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

type RouteContext = { params: Promise<{ path: string[] }> };

function invalidProxyResponse(): Response {
  return new Response(
    JSON.stringify({
      type: "https://nodeprox.dev/problems/invalid-proxy-path",
      title: "Not found",
      status: 404,
      detail: "The requested API route is not available.",
      code: "invalid-proxy-path",
    }),
    {
      status: 404,
      headers: {
        "content-type": "application/problem+json",
        "cache-control": "private, no-store",
      },
    },
  );
}

function unavailableProxyResponse(): Response {
  return new Response(
    JSON.stringify({
      type: "https://nodeprox.dev/problems/proxy-unavailable",
      title: "Bad gateway",
      status: 502,
      detail: "The API service is unavailable.",
      code: "proxy-unavailable",
    }),
    {
      status: 502,
      headers: {
        "content-type": "application/problem+json",
        "cache-control": "private, no-store",
      },
    },
  );
}

function buildBackendUrl(request: Request, path: string[]): string {
  const backendOrigin = new URL(BACKEND_API_ORIGIN);
  const encodedPath = path
    .map((segment) => encodeURIComponent(segment))
    .join("/");
  const url = new URL(`/${encodedPath}`, backendOrigin);
  url.search = new URL(request.url).search;
  return url.toString();
}

async function forward(
  request: Request,
  context: RouteContext,
): Promise<Response> {
  const { path } = await context.params;
  const method = request.method.toUpperCase();
  if (!path.length || !isAllowedProxyRoute(path.join("/"), method))
    return invalidProxyResponse();

  const requestHeaders = new Headers();
  for (const name of FORWARDED_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) requestHeaders.set(name, value);
  }

  try {
    const options: RequestInit & { duplex?: "half" } = {
      method,
      headers: requestHeaders,
      body: request.body,
      redirect: "manual",
      cache: "no-store",
    };
    if (request.body) options.duplex = "half";
    const response = await fetch(buildBackendUrl(request, path), options);
    const responseHeaders = new Headers();
    response.headers.forEach((value, name) => {
      if (name !== "set-cookie" && !HOP_BY_HOP_HEADERS.has(name)) {
        responseHeaders.append(name, value);
      }
    });
    const setCookies = response.headers.getSetCookie?.() ?? [];
    for (const cookie of setCookies)
      responseHeaders.append("set-cookie", cookie);
    if (!setCookies.length) {
      const setCookie = response.headers.get("set-cookie");
      if (setCookie) responseHeaders.append("set-cookie", setCookie);
    }
    responseHeaders.set("cache-control", "private, no-store");
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  } catch {
    return unavailableProxyResponse();
  }
}

export async function GET(request: Request, context: RouteContext) {
  return forward(request, context);
}

export async function POST(request: Request, context: RouteContext) {
  return forward(request, context);
}

export async function PATCH(request: Request, context: RouteContext) {
  return forward(request, context);
}

export async function PUT(request: Request, context: RouteContext) {
  return forward(request, context);
}

export async function DELETE(request: Request, context: RouteContext) {
  return forward(request, context);
}
