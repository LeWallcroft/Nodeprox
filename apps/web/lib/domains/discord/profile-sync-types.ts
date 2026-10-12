export type DiscordProfileSyncStatus = {
  linkedUsers: number;
  missingAvatar: number;
  staleProfiles: number;
  oldestSyncedAt: string | null;
  syncRunning: boolean;
};

export type DiscordProfileSyncTriggerResult =
  | { accepted: true }
  | { accepted: false; reason: "already-running" };
