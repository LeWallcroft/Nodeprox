import type { Readable } from "node:stream";
import type { StorageExecutionResolver } from "@nodeprox/storage/profile-execution";
import type {
  ChapterImageAuthorizationPort,
  ImageQueryContext,
  ImageRepositoryPort,
} from "../ports.js";
import type { ImageMetadata, ImageRecord } from "../../domain/image.types.js";

export class ImageNotFoundError extends Error {
  constructor() {
    super("image-not-found");
    this.name = "ImageNotFoundError";
  }
}

export class ChapterNotFoundError extends Error {
  constructor() {
    super("chapter-not-found");
    this.name = "ChapterNotFoundError";
  }
}

export class ImageAccessDeniedError extends Error {
  constructor() {
    super("image-access-denied");
    this.name = "ImageAccessDeniedError";
  }
}

export class ImageContentNotFoundError extends Error {
  constructor() {
    super("image-content-not-found");
    this.name = "ImageContentNotFoundError";
  }
}

export class ImageContentInfrastructureError extends Error {
  constructor() {
    super("image-content-infrastructure-error");
    this.name = "ImageContentInfrastructureError";
  }
}

const toMetadata = ({
  storageKey: _storageKey,
  storageProfileId: _storageProfileId,
  ...image
}: ImageRecord) => image satisfies ImageMetadata;

export class ImageQueryService {
  constructor(
    private readonly repository: ImageRepositoryPort,
    private readonly authorization: ChapterImageAuthorizationPort,
    private readonly storageExecution: StorageExecutionResolver,
  ) {}

  async list(
    context: ImageQueryContext,
    chapterId: string,
  ): Promise<readonly ImageMetadata[]> {
    await this.authorize(context, chapterId);
    const images = await this.repository.listByChapterId(chapterId);
    return images.map(toMetadata);
  }

  async getMetadata(
    context: ImageQueryContext,
    imageId: string,
  ): Promise<ImageMetadata> {
    const image = await this.findAuthorized(context, imageId);
    return toMetadata(image);
  }

  async getContent(
    context: ImageQueryContext,
    imageId: string,
  ): Promise<{ image: ImageMetadata; stream: Readable }> {
    const image = await this.findAuthorized(context, imageId);
    try {
      return {
        image: toMetadata(image),
        stream: await (
          await this.storageExecution.storageFor(image.storageProfileId)
        ).get(image.storageKey),
      };
    } catch (error) {
      if (isMissingStorageObject(error)) throw new ImageContentNotFoundError();
      throw new ImageContentInfrastructureError();
    }
  }

  private async findAuthorized(
    context: ImageQueryContext,
    imageId: string,
  ): Promise<ImageRecord> {
    const image = await this.repository.findById(imageId);
    if (!image) throw new ImageNotFoundError();
    await this.authorize(context, image.chapterId);
    return image;
  }

  private async authorize(context: ImageQueryContext, chapterId: string) {
    const decision = await this.authorization.check({
      context,
      chapterId,
      permission: "chapters.read",
    });
    if (decision.reason === "not-found") throw new ChapterNotFoundError();
    if (!decision.allowed) throw new ImageAccessDeniedError();
  }
}

function isMissingStorageObject(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  if (
    "code" in error &&
    (error.code === "ENOENT" || error.code === "NoSuchKey")
  )
    return true;
  if (
    "$metadata" in error &&
    typeof error.$metadata === "object" &&
    error.$metadata !== null
  )
    return (
      "httpStatusCode" in error.$metadata &&
      error.$metadata.httpStatusCode === 404
    );
  return false;
}
