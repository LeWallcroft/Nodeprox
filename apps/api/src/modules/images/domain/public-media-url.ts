import { z } from "zod";

const publicMediaId = z.uuid();
const extensionContentTypes = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
} as const;

export type PublicMediaImage = {
  id: string;
  seriesId: string;
  chapterId: string;
  extension: string;
  contentType: string;
};

export class PublicMediaUrl {
  private constructor(private readonly value: string) {}

  static fromImage(origin: string, image: PublicMediaImage): PublicMediaUrl {
    const normalizedOrigin = normalizeOrigin(origin);
    publicMediaId.parse(image.id);
    publicMediaId.parse(image.seriesId);
    publicMediaId.parse(image.chapterId);

    const extension = image.extension.toLowerCase();
    const expectedContentType =
      extensionContentTypes[extension as keyof typeof extensionContentTypes];
    if (!expectedContentType || image.contentType !== expectedContentType)
      throw new Error("image-extension-metadata-mismatch");

    const path = `/series/${image.seriesId}/chapters/${image.chapterId}/images/${image.id}.${extension}`;
    return new PublicMediaUrl(new URL(path, normalizedOrigin).toString());
  }

  toString(): string {
    return this.value;
  }

  toJSON(): string {
    return this.value;
  }
}

function normalizeOrigin(origin: string): string {
  const url = new URL(origin);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (url.pathname !== "/" && url.pathname !== "") ||
    url.search ||
    url.hash
  )
    throw new Error("invalid-public-media-origin");
  return `${url.origin}/`;
}
