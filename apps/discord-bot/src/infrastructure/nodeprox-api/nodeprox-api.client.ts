import type {
  ConfirmDiscordLinkInput,
  ConfirmDiscordLinkResult,
  DiscordIntegrationConfig,
  IssueSeriesCreationGrantInput,
  IssueSeriesCreationGrantResult,
  NodeProxDiscordApi,
  ReplaceDiscordAuthorizedRolesInput,
  ReplaceDiscordAuthorizedRolesResult,
} from "./contracts.js";

export class NodeProxApiError extends Error {
  constructor(
    readonly code: string | null,
    readonly status: number,
    readonly requestId: string | null = null,
    readonly category?: string,
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

  getDiscordConfiguration() {
    return this.request<DiscordIntegrationConfig>(
      "/internal/discord/configuration",
      { method: "GET" },
    );
  }

  replaceAuthorizedRoles(input: ReplaceDiscordAuthorizedRolesInput) {
    return this.request<ReplaceDiscordAuthorizedRolesResult>(
      "/internal/discord/authorized-roles",
      { method: "PUT", body: JSON.stringify(input) },
    );
  }

  issueSeriesCreationGrant(input: IssueSeriesCreationGrantInput) {
    return this.request<IssueSeriesCreationGrantResult>(
      "/internal/discord/series-grants",
      { method: "POST", body: JSON.stringify(input) },
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
    const rawPayload: unknown = await response.json().catch(() => null);
    const payload =
      rawPayload && typeof rawPayload === "object" && !Array.isArray(rawPayload)
        ? (rawPayload as Record<string, unknown>)
        : null;
    if (!response.ok)
      throw new NodeProxApiError(
        typeof payload?.code === "string" ? payload.code : null,
        response.status,
        typeof payload?.requestId === "string"
          ? payload.requestId
          : response.headers.get("x-request-id"),
        typeof payload?.category === "string" ? payload.category : undefined,
      );
    return rawPayload as T;
  }
}
