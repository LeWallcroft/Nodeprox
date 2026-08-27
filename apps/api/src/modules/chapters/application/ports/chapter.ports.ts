import type {
  ChapterPermissionRecord,
  ChapterRecord,
} from "../../domain/chapter.types.js";
import type { DelegableChapterPermission } from "../../domain/chapter-permission.policy.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";

export interface ChapterRepositoryPort {
  findById(id: string): Promise<ChapterRecord | null>;
  isAssigned?(seriesId: string, userId: string): Promise<boolean>;
  isSeriesOwner?(seriesId: string, userId: string): Promise<boolean>;
}

export interface ChapterUserPort {
  existsById(id: string): Promise<boolean>;
}

export interface ChapterPermissionRepositoryPort {
  grant(input: {
    chapterId: string;
    helperUserId: string;
    grantedBy: string;
    permissions: readonly DelegableChapterPermission[];
    cooldownDays: number;
    now: Date;
  }): Promise<
    | { outcome: "granted"; count: number }
    | { outcome: "conflict"; reason: "cooldown" | "already-granted" }
  >;
  revoke(input: {
    chapterId: string;
    helperUserId: string;
    revokedBy: string;
    now: Date;
  }): Promise<{ count: number }>;
  revokeIfAuthorized(input: {
    actor: AuthorizationContext;
    chapterId: string;
    helperUserId: string;
    now: Date;
  }): Promise<
    | { outcome: "revoked"; count: number }
    | { outcome: "denied" }
    | { outcome: "not-found" }
  >;
  hasActivePermission(input: {
    chapterId: string;
    helperUserId: string;
    permission: DelegableChapterPermission;
  }): Promise<boolean>;
  listActive(chapterId: string): Promise<ChapterPermissionRecord[]>;
}
