import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";
import type { Role } from "../../../authorization/domain/roles.js";
import type {
  ChapterCoreRecord,
  SeriesPrincipalUploader,
  SeriesRecord,
  SeriesUploaderCandidate,
} from "../../domain/series.types.js";

export interface SeriesRepositoryPort {
  create(input: {
    title: string;
    slug: string;
    description?: string | null | undefined;
    coverUrl?: string | null | undefined;
    createdBy: string;
  }): Promise<SeriesRecord>;
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
  listAssignedSeriesIds(uploaderId: string): Promise<string[]>;
  isAssigned(seriesId: string, uploaderId: string): Promise<boolean>;
  assign(input: {
    seriesId: string;
    uploaderId: string;
    assignedBy: string;
  }): Promise<void>;
  clear(seriesId: string): Promise<void>;
  listPrincipalUploaders(
    seriesIds: readonly string[],
  ): Promise<ReadonlyMap<string, SeriesPrincipalUploader>>;
  listActiveUploaderCandidates(): Promise<SeriesUploaderCandidate[]>;
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
    uploaderId: string;
  }): Promise<{ outcome: "assigned" } | SeriesMutationFailure>;
  clearAssignmentIfAuthorized(input: {
    actor: AuthorizationContext;
    seriesId: string;
  }): Promise<{ outcome: "cleared" } | SeriesMutationFailure>;
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
  isAssigned?(seriesId: string, uploaderId: string): Promise<boolean>;
}
