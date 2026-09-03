import {
  CdnInvalidationError,
  type CdnInvalidationPort,
} from "../application/ports.js";

type FetchPort = typeof fetch;

export class CloudflareCdnInvalidationAdapter implements CdnInvalidationPort {
  constructor(
    private readonly zoneId: string,
    private readonly token: string,
    private readonly fetcher: FetchPort = fetch,
  ) {}

  async purgeUrls(urls: readonly string[]): Promise<void> {
    if (urls.length === 0) return;
    const files = urls.map((value) => {
      const url = new URL(value);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new CdnInvalidationError("cdn-invalid-url", false);
      return url.toString();
    });
    let response: Response;
    try {
      response = await this.fetcher(
        `https://api.cloudflare.com/client/v4/zones/${encodeURIComponent(this.zoneId)}/purge_cache`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({ files }),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch {
      throw new CdnInvalidationError("cdn-network-error", true);
    }
    if (response.ok) return;
    if (response.status === 429)
      throw new CdnInvalidationError("cdn-rate-limited", true);
    if (response.status >= 500)
      throw new CdnInvalidationError("cdn-provider-error", true);
    if (response.status === 401 || response.status === 403)
      throw new CdnInvalidationError("cdn-authorization-error", false);
    throw new CdnInvalidationError("cdn-request-rejected", false);
  }
}
