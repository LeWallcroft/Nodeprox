export type DomainEventDisposition = "dispatch-required" | "terminal-legacy";

export interface DomainEventPolicyCatalog {
  getDisposition(eventType: string): DomainEventDisposition | null;
}

export const dispatchRequiredEventTypes = [
  "series.creation_grant.issued",
  "series.reactivation.requested",
  "upload.completed",
  "upload.failed",
  "chapter.replacement.ready",
  "image.replacement.ready",
] as const;

export const terminalLegacyEventTypes = [
  "series.responsibility.assigned",
  "series.responsibility.reassigned",
  "series.channel.bound",
  "series.creation_grant.consumed",
  "series.creation_grant.invalidated",
  "discord.identity.linked",
] as const;

const dispositions = new Map<string, DomainEventDisposition>([
  ...dispatchRequiredEventTypes.map(
    (type) => [type, "dispatch-required"] as const,
  ),
  ...terminalLegacyEventTypes.map((type) => [type, "terminal-legacy"] as const),
]);

export const domainEventPolicyCatalog: DomainEventPolicyCatalog = {
  getDisposition(eventType) {
    return dispositions.get(eventType) ?? null;
  },
};
