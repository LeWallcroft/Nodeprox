import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { uploadQueueStorageKey } from "../providers/upload-queue-provider";
import {
  errorLabel,
  isActiveItem,
  isReadyBatch,
  isRetryableImportFailure,
  mediaWarningPresentation,
  requiresChapterReplacement,
  validationIssueMeasurement,
} from "./upload-center";

describe("Upload Center presentation", () => {
  it("keeps browser-tracked batches isolated by authenticated user", () => {
    expect(uploadQueueStorageKey("user-a")).not.toBe(
      uploadQueueStorageKey("user-b"),
    );
    expect(uploadQueueStorageKey("user-a")).toContain("user-a");
  });

  it("only treats a fully ready persisted batch as dismissible", () => {
    expect(
      isReadyBatch({
        batchId: "ready",
        seriesId: "series-1",
        seriesTitle: "Serie",
        trackedAt: 1,
        projection: {
          batchId: "ready",
          status: "completed",
          items: [{ itemId: "item-1", status: "ready" }],
        } as never,
      }),
    ).toBe(true);
    expect(
      isReadyBatch({
        batchId: "processing",
        seriesId: "series-1",
        seriesTitle: "Serie",
        trackedAt: 1,
        projection: {
          batchId: "processing",
          status: "processing",
          items: [{ itemId: "item-1", status: "processing" }],
        } as never,
      }),
    ).toBe(false);
  });

  it("keeps active counts free from completed and failed work", () => {
    expect(isActiveItem("pending")).toBe(true);
    expect(isActiveItem("uploading")).toBe(true);
    expect(isActiveItem("processing")).toBe(true);
    expect(isActiveItem("ready")).toBe(false);
    expect(isActiveItem("failed")).toBe(false);
  });

  it("explains persisted Chapter conflicts and does not offer a misleading retry", () => {
    expect(errorLabel("chapter-media-exists")).toContain("Cambiar capítulo");
    expect(requiresChapterReplacement("chapter-media-exists")).toBe(true);
    expect(isRetryableImportFailure("chapter-media-exists")).toBe(false);
    expect(isRetryableImportFailure("chapter-ready")).toBe(false);
    expect(isRetryableImportFailure("upload-initiation-failed")).toBe(true);
  });

  it("formats warning measurements and retains historical warnings without thresholds", () => {
    expect(
      mediaWarningPresentation({
        code: "large-file",
        filename: "02.webp",
        sizeBytes: 6_815_744,
        thresholdBytes: 5 * 1024 * 1024,
      }),
    ).toEqual({
      title: "Archivo grande",
      actual: "6.5 MB",
      threshold: "5 MB",
    });
    expect(
      mediaWarningPresentation({
        code: "tall-image",
        filename: "03.webp",
        height: 13_420,
      }),
    ).toEqual({ title: "Imagen muy alta", actual: "13 420 px" });
  });

  it("formats known validation issue measurements without raw object values", () => {
    expect(
      validationIssueMeasurement({
        code: "IMAGE_HEIGHT_EXCEEDED",
        actual: { heightPx: 15_842 },
        expected: { maxHeightPx: 12_000 },
      }),
    ).toEqual({ actual: "15 842 px", expected: "12 000 px" });
    expect(
      validationIssueMeasurement({
        code: "IMAGE_SIZE_EXCEEDED",
        actual: { sizeBytes: 6 * 1024 * 1024 },
        expected: { maxImageBytes: 5 * 1024 * 1024 },
      }),
    ).toEqual({ actual: "6 MB", expected: "5 MB" });
    expect(validationIssueMeasurement({ code: "ZIP_INVALID" })).toEqual({});
  });

  it("uses local dismissal and queue-only refresh without deletion", () => {
    const center = readFileSync(
      "apps/web/components/layout/upload-center.tsx",
      "utf8",
    );
    const provider = readFileSync(
      "apps/web/components/providers/upload-queue-provider.tsx",
      "utf8",
    );

    expect(center).toContain("dismissedCompletedBatchIds");
    expect(center).toContain("Limpiar completadas");
    expect(center).toContain("No hay cargas en progreso");
    expect(center).toContain("Seguimiento de cargas en segundo plano.");
    expect(center).toContain('role="tablist"');
    expect(center).toContain("h-[min(44rem,calc(100dvh-7rem))]");
    expect(center).not.toContain("border-primary/35");
    expect(center).not.toContain("border-dashed");
    expect(center).not.toContain("DELETE");
    expect(provider).toContain("refresh(): Promise<void>");
    expect(provider).toContain(
      "tracked.map((batch) => refreshBatch(batch.batchId))",
    );
    expect(center).toContain("visibleRecords.filter");
    expect(center).toContain("previousPathname.current !== pathname");
    expect(center).toContain(
      "Completada con \u0024{warningCount} advertencias",
    );
    expect(center).toContain("Carga rechazada");
    expect(center).toContain("Carga completada con advertencias");
    expect(center).toContain("no bloquearon el procesamiento");
    expect(center).toContain("No se pudo cargar el detalle.");
    expect(center).toContain("Reintentar detalle");
    expect(center).toContain("validationIssueLabel(issue.code)");
    expect(center).toContain("(rejected || warned)");
    expect(center).toContain("validationIssueMeasurement(issue)");
    expect(center).toContain("mediaWarningPresentation(warning)");
    expect(center).toContain(
      'addEventListener("pointerdown", closeWhenLeaving)',
    );
    expect(provider).toContain('operationsForUser(userId ?? "anonymous")');
    expect(provider).toContain("uploadQueueStorageKey(userId)");
  });
});
