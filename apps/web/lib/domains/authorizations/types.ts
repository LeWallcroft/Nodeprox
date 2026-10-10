export type SeriesCreationGrantStatus =
  | "available"
  | "reserved"
  | "consumed"
  | "invalidated";

export interface SeriesCreationGrantListItem {
  id: string;
  displayCode: string;
  reference: string | null;
  status: SeriesCreationGrantStatus;
  issuedAt: string;
  applicable?: boolean;
}

export interface AdminSeriesCreationGrantListItem
  extends SeriesCreationGrantListItem {
  consumedAt: string | null;
  createdSeries: {
    id: string;
    title: string;
    slug: string;
  } | null;
  targetUser: UserReference;
}

export interface AdminSeriesCreationGrantPage {
  items: AdminSeriesCreationGrantListItem[];
  nextCursor: string | null;
}

export type AdminUserLookupItem = UserReference;

export interface AdminUserLookupPage {
  items: AdminUserLookupItem[];
  nextCursor: string | null;
}

export interface IssueSeriesCreationGrantInput {
  targetUserId: string;
  reference?: string;
}

export interface IssuedSeriesCreationGrant {
  id: string;
  displayCode: string;
  status: SeriesCreationGrantStatus;
  issuedAt: string;
}

export interface GrantHistoryItem {
  type: "issued" | "consumed" | "invalidated";
  occurredAt: string;
  actor: UserReference | null;
  series: { id: string; title: string; slug: string } | null;
}

import type { UserReference } from "@nodeprox/types";
