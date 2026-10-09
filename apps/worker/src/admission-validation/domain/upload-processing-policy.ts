export type UploadProcessingPolicy = {
  warnings: {
    warnImageBytes: number;
    warnWidthPx: number;
    warnHeightPx: number;
  };
  admission: {
    maxImageBytes: number;
    maxWidthPx?: number;
    maxHeightPx?: number;
    maxPixels?: number;
    maxCompressionRatio?: number;
  };
};

export function minDefined(
  product: number | undefined,
  infrastructure: number | undefined,
): number | undefined {
  if (product === undefined) return infrastructure;
  if (infrastructure === undefined) return product;
  return Math.min(product, infrastructure);
}

export function buildUploadProcessingPolicy(
  settings: ReadonlyMap<string, number>,
  infrastructure: {
    maxImageBytes: number;
    maxWidthPx?: number;
    maxHeightPx?: number;
    maxPixels?: number;
    maxCompressionRatio?: number;
  },
): UploadProcessingPolicy {
  const productImageBytes =
    (settings.get("upload_max_image_size_mb") ?? 64) * 1024 * 1024;
  const positive = (key: string) => {
    const value = settings.get(key) ?? 0;
    return value > 0 ? value : undefined;
  };
  const warnings = {
    warnImageBytes:
      (settings.get("upload_warning_image_size_mb") ?? 8) * 1024 * 1024,
    warnWidthPx: settings.get("upload_warning_width_px") ?? 4000,
    warnHeightPx: settings.get("upload_warning_height_px") ?? 12000,
  };
  const maxWidthPx = minDefined(
    positive("upload_max_width_px"),
    infrastructure.maxWidthPx,
  );
  const maxHeightPx = minDefined(
    positive("upload_max_height_px"),
    infrastructure.maxHeightPx,
  );
  const maxPixels = minDefined(
    positive("upload_max_pixels"),
    infrastructure.maxPixels,
  );
  const maxCompressionRatio = minDefined(
    positive("upload_max_compression_ratio"),
    infrastructure.maxCompressionRatio,
  );
  return {
    warnings,
    admission: {
      maxImageBytes: Math.min(productImageBytes, infrastructure.maxImageBytes),
      ...(maxWidthPx !== undefined ? { maxWidthPx } : {}),
      ...(maxHeightPx !== undefined ? { maxHeightPx } : {}),
      ...(maxPixels !== undefined ? { maxPixels } : {}),
      ...(maxCompressionRatio !== undefined ? { maxCompressionRatio } : {}),
    },
  };
}
