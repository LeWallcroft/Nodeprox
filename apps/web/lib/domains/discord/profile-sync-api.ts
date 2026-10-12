import { apiRequestBrowser } from "../../api/browser";
import type {
  DiscordProfileSyncStatus,
  DiscordProfileSyncTriggerResult,
} from "./profile-sync-types";

export function getDiscordProfileSyncStatus() {
  return apiRequestBrowser<DiscordProfileSyncStatus>(
    "/admin/discord/profile-sync",
  );
}

export function triggerDiscordProfileSync() {
  return apiRequestBrowser<DiscordProfileSyncTriggerResult>(
    "/admin/discord/profile-sync",
    { method: "POST" },
  );
}
