export interface Series {
  id: string;
  title: string;
  slug: string;
  description: string | null;
  coverUrl: string | null;
  discordChannelId: string | null;
  discordChannelNameSnapshot: string | null;
  responsibleUser: SeriesResponsibleUser | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  operationalState: "active" | "inactive";
  inactiveReason: "dropped" | "hiatus" | "completed" | "other" | null;
  inactiveReasonDetail: string | null;
  stateChangedAt: string;
}

/** Collection-only projection returned by GET /series. */
export interface SeriesListProjection extends Series {
  chapterCount: number;
  imageCount: number;
  hasPendingReactivationRequest: boolean;
  hasApprovedReactivationRequest: boolean;
  lastApprovedAt: string | null;
}

export interface SeriesLifecycleDetail {
  operationalState: Series["operationalState"];
  inactiveReason: Series["inactiveReason"];
  inactiveReasonDetail: string | null;
  stateChangedAt: string;
  stateChangedBy: string | null;
  history: Array<{
    id: string;
    previousState: Series["operationalState"];
    nextState: Series["operationalState"];
    inactiveReason: Series["inactiveReason"];
    inactiveReasonDetail: string | null;
    actorUserId: string;
    responsibleUserIdAtEvent: string | null;
    responsibleLabelSnapshot: string | null;
    sourceRequestId: string | null;
    occurredAt: string;
  }>;
  requests: Array<{
    id: string;
    requestedBy: string;
    requestedByLabel: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
    requestNote: string | null;
    requestedAt: string;
    reviewedBy: string | null;
    reviewedAt: string | null;
    resolutionNote: string | null;
  }>;
}

export interface SeriesResponsibleUser {
  id: string;
  email: string;
  role: "admin" | "gestor" | "uploader";
  discordUsername: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  discordLinked: boolean;
}

export type SeriesResponsibleCandidate = SeriesResponsibleUser;

export interface SeriesInput {
  title: string;
  description?: string | null;
  coverUrl?: string | null;
  grantId?: string;
  discordChannelId?: string;
}

export interface SelectableDiscordSeriesChannel {
  id: string;
  name: string;
}

export interface SeriesCapabilitiesProjection {
  capabilities: readonly string[];
}
