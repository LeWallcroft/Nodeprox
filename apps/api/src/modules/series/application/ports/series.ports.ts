import type {
  ChapterCoreRecord,
  SeriesRecord,
} from "../../domain/series.types.js";
import type { AuthorizationContext } from "../../../authorization/domain/authorization.types.js";

export interface SeriesRepositoryPort {
  create(input: {
    title: string;
    slug: string;
    description?: string | null | undefined;
    createdBy: string;
  }): Promise<SeriesRecord>;
  listByOwner(ownerId: string): Promise<SeriesRecord[]>;
  listAll(): Promise<SeriesRecord[]>;
  findById(id: string): Promise<SeriesRecord | null>;
  update(
    id: string,
    input: {
      title?: string | undefined;
      slug?: string | undefined;
      description?: string | null | undefined;
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
      slug?: string | undefined;
      description?: string | null | undefined;
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
