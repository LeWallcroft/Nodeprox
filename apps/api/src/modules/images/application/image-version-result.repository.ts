import type { CanonicalImageReplacementResult } from "./media-replacement.ports.js";

export interface ImageVersionResultRepository {
  findVersionResultById(
    imageVersionId: string,
  ): Promise<CanonicalImageReplacementResult | null>;
}
