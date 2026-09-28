import { describe, expect, it } from "vitest";
import { GetPublishedChapter } from "../../apps/api/src/modules/publication/application/services/get-published-chapter.js";
import type { PublishedChapterRepositoryPort } from "../../apps/api/src/modules/publication/application/ports/published-chapter.repository.js";
import type { PublishedChapterRecord } from "../../apps/api/src/modules/publication/domain/publication.types.js";

const chapter = {
  id: "33333333-3333-4333-8333-333333333333",
  seriesId: "22222222-2222-4222-8222-222222222222",
  seriesPublicSlug: "raven",
  chapterNumber: 1,
  chapterPublicKey: "1",
  title: "Chapter One",
  status: "ready" as const,
};

const images = [
  {
    id: "55555555-5555-4555-8555-555555555555",
    chapterId: chapter.id,
    filename: "00.jpg",
    storageKey: "Media/raven/1/00.jpg",
    storageProfileId: "00000000-0000-4000-8000-000000000001",
    extension: "jpg",
    contentType: "image/jpeg",
    sizeBytes: 30,
    sortOrder: 0,
  },
  {
    id: "11111111-1111-4111-8111-111111111111",
    chapterId: chapter.id,
    filename: "02.png",
    storageKey: "Media/raven/1/02.png",
    storageProfileId: "00000000-0000-4000-8000-000000000001",
    extension: "png",
    contentType: "image/png",
    sizeBytes: 20,
    sortOrder: 2,
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    chapterId: chapter.id,
    filename: "01.jpg",
    storageKey: "Media/raven/1/01.jpg",
    storageProfileId: "00000000-0000-4000-8000-000000000001",
    extension: "jpg",
    contentType: "image/jpeg",
    sizeBytes: 10,
    sortOrder: 1,
  },
];

function repository(
  chapterValue: PublishedChapterRecord | null = chapter,
  imageValues = images,
): PublishedChapterRepositoryPort {
  return {
    findChapterById: async () => chapterValue,
    listImagesByChapterId: async () => imageValues,
  };
}

describe("GetPublishedChapter", () => {
  it("resolves mixed historical media by each persisted profile, including retired profiles", async () => {
    const managedId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const resolved: string[] = [];
    const [legacyImage, managedImage] = images;
    if (!legacyImage || !managedImage) throw new Error("missing-image-fixture");
    const mixed = [
      legacyImage,
      { ...managedImage, storageProfileId: managedId },
    ];
    const result = await new GetPublishedChapter(repository(chapter, mixed), {
      async originFor(profileId: string) {
        resolved.push(profileId);
        return profileId === managedId
          ? "https://manga.nodeprox.org"
          : "https://media.nodeprox.org";
      },
    }).execute(chapter.id);
    expect(resolved).toEqual([legacyImage.storageProfileId, managedId]);
    expect(result.images.map((image) => image.url)).toEqual([
      "https://media.nodeprox.org/raven/1/00.jpg",
      "https://manga.nodeprox.org/raven/1/02.png",
    ]);
  });
  it("publishes a ready chapter with sorted canonical image URLs", async () => {
    const result = await new GetPublishedChapter(
      repository(),
      "https://media.nodeprox.org/",
    ).execute(chapter.id);

    expect(result).toEqual({
      id: chapter.id,
      seriesId: chapter.seriesId,
      chapterNumber: 1,
      title: "Chapter One",
      images: [
        {
          id: images[0]?.id,
          filename: images[0]?.filename,
          extension: images[0]?.extension,
          contentType: images[0]?.contentType,
          sizeBytes: images[0]?.sizeBytes,
          sortOrder: images[0]?.sortOrder,
          url: `https://media.nodeprox.org/raven/1/00.jpg`,
        },
        {
          id: images[2]?.id,
          filename: images[2]?.filename,
          extension: images[2]?.extension,
          contentType: images[2]?.contentType,
          sizeBytes: images[2]?.sizeBytes,
          sortOrder: images[2]?.sortOrder,
          url: `https://media.nodeprox.org/raven/1/01.jpg`,
        },
        {
          id: images[1]?.id,
          filename: images[1]?.filename,
          extension: images[1]?.extension,
          contentType: images[1]?.contentType,
          sizeBytes: images[1]?.sizeBytes,
          sortOrder: images[1]?.sortOrder,
          url: `https://media.nodeprox.org/raven/1/02.png`,
        },
      ],
    });
    expect(result.images[0]).not.toHaveProperty("storageKey");
    expect(result.images[0]).not.toHaveProperty("checksum");
    expect(result.images[0]).not.toHaveProperty("provider");
  });

  it.each(["draft", "uploading", "uploaded", "processing", "failed"] as const)(
    "rejects a %s chapter as not found",
    async (status) => {
      await expect(
        new GetPublishedChapter(
          repository({ ...chapter, status } as PublishedChapterRecord),
          "https://media.nodeprox.org",
        ).execute(chapter.id),
      ).rejects.toMatchObject({ message: "published-chapter-not-found" });
    },
  );

  it("rejects a missing chapter as not found", async () => {
    await expect(
      new GetPublishedChapter(
        repository(null),
        "https://media.nodeprox.org",
      ).execute(chapter.id),
    ).rejects.toMatchObject({ message: "published-chapter-not-found" });
  });

  it("fails closed when a ready chapter has incomplete image metadata", async () => {
    await expect(
      new GetPublishedChapter(
        repository(chapter, []),
        "https://media.nodeprox.org",
      ).execute(chapter.id),
    ).rejects.toMatchObject({ message: "published-chapter-integrity-error" });
  });
});
