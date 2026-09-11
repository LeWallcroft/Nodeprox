import { apiRequestBrowser } from "../../api/browser";
import type { DiscordAuthorizationConfiguration } from "./types";

export function getDiscordAuthorizationConfiguration() {
  return apiRequestBrowser<DiscordAuthorizationConfiguration>(
    "/admin/discord/authorized-roles",
  );
}

export function replaceDiscordAuthorizationConfiguration(
  roles: DiscordAuthorizationConfiguration["roles"],
) {
  return apiRequestBrowser<DiscordAuthorizationConfiguration>(
    "/admin/discord/authorized-roles",
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ roles }),
    },
  );
}
