import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { Role } from "../../../authorization/domain/roles.js";
import type {
  ChapterCoreRecord,
  SeriesRecord,
  SeriesResponsibleCandidate,
  SeriesResponsibleUser,
} from "../../domain/series.types.js";

export interface SeriesRepositoryPort {
  createWithCreationPolicy(input: {
    title: string;
    slug: string;
    description?: string | null | undefined;
    coverUrl?: string | null | undefined;
    createdBy: string;
    actorRole: "admin" | "gestor" | "uploader";
    grantId?: string | undefined;
    discordChannelId?: string | undefined;
    discordChannelNameSnapshot?: string | undefined;
  }): Promise<
    | { outcome: "created"; series: SeriesRecord }
    | {
        outcome:
          | "grant-not-found"
          | "grant-not-owned"
          | "grant-unavailable"
          | "channel-required";
      }
  >;
  listByOwner(ownerId: string): Promise<SeriesRecord[]>;
  listAll(): Promise<SeriesRecord[]>;
  listWithHelperAccess(userId: string): Promise<SeriesRecord[]>;
  hasHelperAccess(seriesId: string, userId: string): Promise<boolean>;
  findById(id: string): Promise<SeriesRecord | null>;
  update(
    id: string,
    input: {
      title?: string | undefined;
      description?: string | null | undefined;
      coverUrl?: string | null | undefined;
    },
  ): Promise<SeriesRecord | null>;
  delete(id: string): Promise<void>;
  countChapters(id: string): Promise<number>;
}

export interface SeriesAssignmentRepositoryPort {
  listAssignedSeriesIds(responsibleUserId: string): Promise<string[]>;
  isAssigned(seriesId: string, responsibleUserId: string): Promise<boolean>;
  assign(input: {
    seriesId: string;
    responsibleUserId: string;
    assignedBy: string;
  }): Promise<void>;
  listResponsibleUsers(
    seriesIds: readonly string[],
  ): Promise<ReadonlyMap<string, SeriesResponsibleUser>>;
  listActiveResponsibleCandidates(): Promise<SeriesResponsibleCandidate[]>;
}

export interface SeriesUserPort {
  findById(id: string): Promise<{
    id: string;
    status: string;
    role?: "admin" | "gestor" | "uploader";
  } | null>;
}

export type SeriesMutationFailure =
  | { outcome: "denied" }
  | { outcome: "not-found" }
  | { outcome: "conflict" }
  | { outcome: "invalid-target" };

export interface SeriesMutationBoundaryPort {
  updateIfAuthorized(input: {
    actor: AuthorizationContext;
    seriesId: string;
    mutation: {
      title?: string | undefined;
      description?: string | null | undefined;
      coverUrl?: string | null | undefined;
    };
  }): Promise<
    { outcome: "updated"; series: SeriesRecord } | SeriesMutationFailure
  >;
  deleteIfAuthorized(input: {
    actor: AuthorizationContext;
    seriesId: string;
  }): Promise<{ outcome: "deleted" } | SeriesMutationFailure>;
  assignIfAuthorized(input: {
    actor: AuthorizationContext;
    seriesId: string;
    responsibleUserId: string;
  }): Promise<{ outcome: "assigned" } | SeriesMutationFailure>;
}

export interface ChapterCoreRepositoryPort {
  create(input: {
    seriesId: string;
    chapterNumber: number;
    title?: string | null | undefined;
    createdBy: string;
  }): Promise<ChapterCoreRecord>;
  listBySeries(seriesId: string): Promise<ChapterCoreRecord[]>;
  listBySeriesVisibleForActor(input: {
    seriesId: string;
    userId: string;
    role: Role;
  }): Promise<ChapterCoreRecord[]>;
  listVisibleForActor(input: { userId: string; role: Role }): Promise<
    Array<
      ChapterCoreRecord & {
        series: {
          id: string;
          title: string;
          slug: string;
          coverUrl: string | null;
        };
      }
    >
  >;
  findById(id: string): Promise<ChapterCoreRecord | null>;
  update(
    id: string,
    input: {
      chapterNumber?: number | undefined;
      title?: string | null | undefined;
    },
  ): Promise<ChapterCoreRecord | null>;
  delete(id: string): Promise<void>;
  isAssigned?(seriesId: string, responsibleUserId: string): Promise<boolean>;
}
