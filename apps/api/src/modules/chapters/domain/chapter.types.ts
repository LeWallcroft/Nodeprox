export interface ChapterRecord {
  id: string;
  seriesId: string;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ChapterPermissionRecord {
  id: string;
  chapterId: string;
  helperUserId: string;
  permission: string;
  grantedBy: string;
  grantedAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
}
