import { apiRequestBrowser } from "../../api/browser";
import type {
  DiscordProfileSyncStatus,
  DiscordProfileSyncTriggerResult,
  ProductSettings,
} from "./types";

export function getProductSettings() {
  return apiRequestBrowser<ProductSettings>("/admin/settings");
}

export function updateProductSettings(
  changes: Array<{ key: string; value: number | boolean | string }>,
) {
  return apiRequestBrowser<ProductSettings>("/admin/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}

export function getDiscordProfileSyncStatus() {
  return apiRequestBrowser<DiscordProfileSyncStatus>(
    "/admin/maintenance/discord-profiles",
  );
}

export function triggerDiscordProfileSync() {
  return apiRequestBrowser<DiscordProfileSyncTriggerResult>(
    "/admin/maintenance/discord-profiles/sync",
    { method: "POST" },
  );
}
