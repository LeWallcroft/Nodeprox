export interface DiscordProfileSyncLeaseHandle {
  release(): Promise<void>;
}

export interface DiscordProfileSyncLeasePort {
  tryAcquire(): Promise<DiscordProfileSyncLeaseHandle | null>;
}
