import type { PublicImage } from "./types";

export function sortPublicImages(images: readonly PublicImage[]) {
  return [...images].sort((left, right) => left.sortOrder - right.sortOrder);
}

export function publicImageUrls(images: readonly PublicImage[]) {
  return sortPublicImages(images).map((image) => image.url);
}

export function publicImageUrlsText(images: readonly PublicImage[]) {
  return publicImageUrls(images).join("\n");
}
