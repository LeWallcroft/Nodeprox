import type { Readable } from "node:stream";
import type { AuthorizationContext } from "../../authorization/domain/authorization.types.js";
import type { ImageMetadata, ImageRecord } from "../domain/image.types.js";

export interface ImageRepositoryPort {
  listByChapterId(chapterId: string): Promise<readonly ImageRecord[]>;
  findById(imageId: string): Promise<ImageRecord | null>;
}

export interface ChapterImageAuthorizationPort {
  check(input: {
    context: AuthorizationContext;
    chapterId: string;
    permission: string;
  }): Promise<{ allowed: boolean; reason: string }>;
}

export interface ImageContentPort {
  get(key: string): Promise<Readable>;
}

export type ImageQueryContext = AuthorizationContext;

export type ImageQueryResult = {
  images: readonly ImageMetadata[];
};
