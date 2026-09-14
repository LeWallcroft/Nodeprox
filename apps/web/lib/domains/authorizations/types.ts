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
}

export interface AdminSeriesCreationGrantListItem
  extends SeriesCreationGrantListItem {
  targetUser: {
    id: string;
    displayName: string;
  };
}

export interface AdminSeriesCreationGrantPage {
  items: AdminSeriesCreationGrantListItem[];
  nextCursor: string | null;
}
