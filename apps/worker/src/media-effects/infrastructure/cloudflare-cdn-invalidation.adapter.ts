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
    private readonly isManagedHostname: (
      hostname: string,
    ) => Promise<boolean> = async () => false,
  ) {}

  async purgeUrls(urls: readonly string[]): Promise<void> {
    if (urls.length === 0) return;
    const prefixes: string[] = [];
    for (const value of urls) {
      let url: URL;
      try {
        url = new URL(value);
      } catch {
        throw new CdnInvalidationError("cdn-invalid-url", false);
      }
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new CdnInvalidationError("cdn-invalid-url", false);
      if (
        url.username ||
        url.password ||
        url.port ||
        (url.hostname !== "media.nodeprox.org" &&
          !(
            url.hostname.endsWith(".nodeprox.org") &&
            (await this.isManagedHostname(url.hostname))
          ))
      )
        throw new CdnInvalidationError("cdn-invalid-url", false);
      prefixes.push(`${url.hostname}${url.pathname}`);
    }
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
          body: JSON.stringify({ prefixes: [...new Set(prefixes)] }),
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
