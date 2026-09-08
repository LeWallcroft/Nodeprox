import type {
  ConfirmDiscordLinkInput,
  ConfirmDiscordLinkResult,
  DiscordIntegrationConfig,
  NodeProxDiscordApi,
} from "./contracts.js";

export class NodeProxApiError extends Error {
  constructor(
    readonly code: string | null,
    readonly status: number,
  ) {
    super(code ?? "nodeprox-api-error");
  }
}

export class NodeProxApiClient implements NodeProxDiscordApi {
  constructor(
    private readonly baseUrl: string,
    private readonly internalToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  confirmLink(input: ConfirmDiscordLinkInput) {
    return this.request<ConfirmDiscordLinkResult>(
      "/internal/discord/confirm-link",
      { method: "POST", body: JSON.stringify(input) },
    );
  }

  getIntegration() {
    return this.request<DiscordIntegrationConfig>(
      "/internal/discord/integration",
      { method: "GET" },
    );
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    let response: Response;
    try {
      response = await this.fetcher(new URL(path, this.baseUrl), {
        ...init,
        headers: {
          authorization: `Bearer ${this.internalToken}`,
          "content-type": "application/json",
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new NodeProxApiError(null, 0);
    }
    const payload = (await response.json().catch(() => null)) as {
      code?: unknown;
    } | null;
    if (!response.ok)
      throw new NodeProxApiError(
        typeof payload?.code === "string" ? payload.code : null,
        response.status,
      );
    return payload as T;
  }
}
