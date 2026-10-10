import {
  CHAPTER_IMAGE_EXTENSIONS,
  buildUploadProcessingPolicy,
  resolveDirectUploadConcurrency,
  type UserUploadPolicy,
} from "@nodeprox/types";
import type { UploadPolicySettingsPort } from "../ports/upload-policy-settings.port.js";

export const USER_UPLOAD_POLICY_SETTING_KEYS = [
  "upload_warning_image_size_mb",
  "upload_warning_width_px",
  "upload_warning_height_px",
  "upload_max_image_size_mb",
  "upload_max_width_px",
  "upload_max_height_px",
  "upload_max_pixels",
  "upload_max_compression_ratio",
  "bulk_upload_concurrency",
] as const;

export class GetUserUploadPolicyService {
  constructor(
    private readonly settings: UploadPolicySettingsPort,
    private readonly infrastructure: {
      maxUploadBytes: number;
      maxEntries: number;
      maxExpandedBytes: number;
      maxImageBytes: number;
      maxWidthPx?: number;
      maxHeightPx?: number;
      maxPixels?: number;
      maxCompressionRatio?: number;
    },
  ) {}

  async execute(): Promise<UserUploadPolicy> {
    const settings = await this.settings.readNumbers(
      USER_UPLOAD_POLICY_SETTING_KEYS,
    );
    const policy = buildUploadProcessingPolicy(settings, {
      maxImageBytes: this.infrastructure.maxImageBytes,
      ...(this.infrastructure.maxWidthPx !== undefined
        ? { maxWidthPx: this.infrastructure.maxWidthPx }
        : {}),
      ...(this.infrastructure.maxHeightPx !== undefined
        ? { maxHeightPx: this.infrastructure.maxHeightPx }
        : {}),
      ...(this.infrastructure.maxPixels !== undefined
        ? { maxPixels: this.infrastructure.maxPixels }
        : {}),
      ...(this.infrastructure.maxCompressionRatio !== undefined
        ? { maxCompressionRatio: this.infrastructure.maxCompressionRatio }
        : {}),
    });

    return {
      zip: {
        maxUploadBytes: this.infrastructure.maxUploadBytes,
        maxEntries: this.infrastructure.maxEntries,
        maxExpandedBytes: this.infrastructure.maxExpandedBytes,
        layouts: ["flat", "single-wrapper"],
      },
      images: {
        allowedExtensions: CHAPTER_IMAGE_EXTENSIONS,
        filenameRule: "two-digit-sequence",
        maxImageBytes: policy.admission.maxImageBytes,
        maxWidthPx: policy.admission.maxWidthPx ?? null,
        maxHeightPx: policy.admission.maxHeightPx ?? null,
        maxPixels: policy.admission.maxPixels ?? null,
        maxCompressionRatio: policy.admission.maxCompressionRatio ?? null,
      },
      warnings: {
        imageBytes: policy.warnings.warnImageBytes,
        widthPx: policy.warnings.warnWidthPx,
        heightPx: policy.warnings.warnHeightPx,
      },
      transfer: {
        maxConcurrentUploads: resolveDirectUploadConcurrency(
          settings.get("bulk_upload_concurrency"),
        ),
      },
    };
  }
}
