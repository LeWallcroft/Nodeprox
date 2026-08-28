import { z } from "zod";

const publicSlug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const publicFilename = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[^/\\]+\.(?:jpe?g|png|webp|gif)$/i);

const extensionContentTypes = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  gif: "image/gif",
} as const;

export type PublicMediaImage = {
  seriesPublicSlug: string;
  chapterPublicKey: string;
  filename: string;
  contentType: string;
};

export class PublicMediaUrl {
  private constructor(private readonly value: string) {}

  static fromImage(origin: string, image: PublicMediaImage): PublicMediaUrl {
    const normalizedOrigin = normalizeOrigin(origin);
    const slug = publicSlug.parse(image.seriesPublicSlug);
    const chapterPublicKey = publicSlug.parse(image.chapterPublicKey);
    const filename = publicFilename.parse(image.filename);

    const extension = filename
      .slice(filename.lastIndexOf(".") + 1)
      .toLowerCase();
    const expectedContentType =
      extensionContentTypes[extension as keyof typeof extensionContentTypes];
    if (!expectedContentType || image.contentType !== expectedContentType)
      throw new Error("image-extension-metadata-mismatch");

    const path = `/${encodeURIComponent(slug)}/${encodeURIComponent(chapterPublicKey)}/${encodeURIComponent(filename)}`;
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
