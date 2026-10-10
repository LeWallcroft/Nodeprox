import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BackgroundUploadOperation } from "../../lib/domains/uploads/background-operations";
import {
  fillOutcomeNoticeSlots,
  isUploadOutcomeDismissed,
  observeUploadOutcomeTransitions,
  sanitizeDismissedUploadOutcomes,
  uploadCenterDismissalStorageKey,
} from "../../lib/domains/uploads/upload-center-state";
import {
  canLoadValidationReport,
  compareUploadCenterRecords,
  mergeUploadCenterRecords,
  type UploadCenterRecord,
  uploadCenterSummary,
  uploadOutcomeFingerprint,
} from "../../lib/domains/uploads/upload-center-view-model";
import {
  mediaWarningPresentation,
  UploadOperationDetailDialog,
  validationIssueMeasurement,
} from "../domains/uploads/upload-operation-detail-dialog";
import {
  uploadBatchOutcomePresentation,
  uploadOutcomeMessage,
} from "../domains/uploads/upload-outcome-message";
import {
  UploadResultDialog,
  uploadResultPresentation,
} from "../domains/uploads/upload-result-dialog";
import { uploadQueueStorageKey } from "../providers/upload-queue-provider";

function operation(
  overrides: Partial<BackgroundUploadOperation> = {},
): BackgroundUploadOperation {
  return {
    id: "op-1",
    kind: "chapter_upload",
    seriesId: "series-1",
    seriesTitle: "Serie",
    chapterId: "chapter-1",
    chapterNumber: 2,
    imageId: null,
    filename: "chapter.zip",
    status: "ready",
    errorCode: null,
    warningCount: 0,
    issueCount: 0,
    fileCount: null,
    totalSizeBytes: null,
    failureStage: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T11:00:00.000Z",
    completedAt: "2026-01-01T11:00:00.000Z",
    ...overrides,
  };
}

function record(
  overrides: Partial<UploadCenterRecord> = {},
): UploadCenterRecord {
  const base = {
    id: "op-1",
    kind: "chapter_upload" as const,
    groupId: null,
    seriesId: "s1",
    seriesTitle: "Serie",
    chapterId: "c1",
    chapterNumber: 1,
    filename: "a.zip",
    status: "ready" as const,
    warningCount: 0,
    issueCount: 0,
    fileCount: null,
    totalSizeBytes: null,
    errorCode: null,
    failureStage: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    updatedAt: "2026-01-01T11:00:00.000Z",
    completedAt: null,
    activityAt:
      overrides.activityAt ?? overrides.updatedAt ?? "2026-01-01T11:00:00.000Z",
    outcomeAt:
      overrides.outcomeAt ??
      overrides.completedAt ??
      overrides.updatedAt ??
      "2026-01-01T11:00:00.000Z",
    retryable: false,
    ephemeral: false,
    outcomeFingerprint: "",
    batchId: null,
    uploadId: null,
    ...overrides,
  };
  return { ...base, outcomeFingerprint: uploadOutcomeFingerprint(base) };
}

describe("Upload Center view model and state", () => {
  it("gives result outcomes a fixed soft modal geometry", () => {
    for (const status of ["ready", "rejected", "retry_exhausted"] as const) {
      const markup = renderToStaticMarkup(
        <UploadResultDialog
          open
          operation={record({
            status,
            warningCount: status === "ready" ? 2 : 0,
          })}
          onOpenChange={() => undefined}
          onDetails={() => undefined}
          onCenter={() => undefined}
        />,
      );
      expect(markup).toContain("max-w-[560px]");
      expect(markup).toContain("h-[min(26.25rem,calc(100dvh-3rem))]");
    }
  });

  it("colors result metadata and gives modal actions semantic icons", () => {
    const renderResult = (operation: UploadCenterRecord) =>
      renderToStaticMarkup(
        <UploadResultDialog
          open
          operation={operation}
          onOpenChange={() => undefined}
          onDetails={() => undefined}
          onCenter={() => undefined}
        />,
      );
    const success = renderResult(
      record({ fileCount: 15, totalSizeBytes: 42 * 1024 * 1024 }),
    );
    expect(success).toContain("bg-success/10 text-success");
    expect(success).toContain("Archivos");
    expect(success).toContain(">15</span>");
    expect(success).toContain("Tamaño total");
    expect(success).toContain("Validación");
    expect(success).toContain("Sin incidencias");
    expect(success).toContain("rounded-full bg-success/10 text-success");
    expect(success).toContain('aria-label="Cerrar diálogo"');
    expect(success).toContain("Ver en capítulos");
    expect(success).toContain("inline-flex items-center justify-center gap-2");
    expect(success).toMatch(/<svg[^>]*aria-hidden="true"/);

    const warning = renderResult(
      record({
        warningCount: 14,
        fileCount: 15,
        totalSizeBytes: 42 * 1024 * 1024,
      }),
    );
    expect(warning).toContain("bg-warning/10 text-warning-text");
    expect(warning).toContain("Advertencias");
    expect(warning).toContain(">14</span>");
    expect(warning).toContain("Ver detalle");
    expect(warning).toContain('data-testid="result-icon-warning"');
    expect(warning).not.toContain("border-warning/30");
    expect(warning).toMatch(/<svg[^>]*aria-hidden="true"/);

    const rejected = renderResult(
      record({ status: "rejected", issueCount: 3, fileCount: 5 }),
    );
    expect(rejected).toContain("bg-destructive-surface text-destructive-text");
    expect(rejected).toContain("Archivos");
    expect(rejected).toContain(">5</span>");
    expect(rejected).toContain("Problemas encontrados");
    expect(rejected).toContain(">3</span>");
    expect(rejected).not.toContain("0 de 5");
    expect(rejected).not.toContain("border-destructive/30");
    expect(rejected).toContain("Subir ZIP corregido");
    expect(rejected).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("gives detail tabs and validation states one stable scrolling workspace", () => {
    const markup = renderToStaticMarkup(
      <UploadOperationDetailDialog
        open
        operation={record({ status: "ready", warningCount: 25 })}
        onOpenChange={() => undefined}
      />,
    );
    expect(markup).toContain("max-w-[760px]");
    expect(markup).toContain("h-[min(42rem,calc(100dvh-3rem))]");
    expect(markup).toContain("overflow-y-auto rounded-control bg-surface/50");
    expect(markup).toContain("rounded-control bg-surface p-1");
    expect(markup).not.toContain("border-b border-[var(--border-subtle)]");
  });

  it("orders active work by latest activity and uses deterministic tie-breaks", () => {
    const older = operation({
      id: "a",
      status: "processing",
      createdAt: "2026-01-01T10:00:00Z",
      updatedAt: "2026-01-01T10:25:00Z",
      completedAt: null,
    });
    const newer = operation({
      id: "b",
      status: "processing",
      createdAt: "2026-01-01T10:10:00Z",
      updatedAt: "2026-01-01T10:20:00Z",
      completedAt: null,
    });
    const rows = mergeUploadCenterRecords({
      operations: [older, newer],
      batches: [],
    });
    expect(rows.map((row) => row.id)).toEqual(["a", "b"]);
    expect(
      compareUploadCenterRecords(
        { id: "a", createdAt: "same", activityAt: "same" },
        { id: "b", createdAt: "same", activityAt: "same" },
      ),
    ).toBeGreaterThan(0);
  });

  it("orders completed by completion and errors by their outcome timestamp", () => {
    const completed = mergeUploadCenterRecords({
      operations: [
        operation({ id: "a", completedAt: "2026-01-01T10:20:00Z" }),
        operation({ id: "b", completedAt: "2026-01-01T10:30:00Z" }),
      ],
      batches: [],
    });
    expect(completed.map((record) => record.id)).toEqual(["b", "a"]);
    const errors = mergeUploadCenterRecords({
      operations: [
        operation({
          id: "a",
          status: "rejected",
          updatedAt: "2026-01-01T10:30:00Z",
        }),
        operation({
          id: "b",
          status: "failed",
          updatedAt: "2026-01-01T10:25:00Z",
        }),
        operation({
          id: "c",
          status: "rejected",
          updatedAt: "2026-01-01T10:10:00Z",
        }),
      ],
      batches: [],
    });
    expect(errors.map((record) => record.id)).toEqual(["a", "b", "c"]);
  });

  it("deduplicates persisted import projections and replaces ephemeral items", () => {
    const batch = {
      batchId: "batch-1",
      seriesId: "s1",
      seriesTitle: "Serie",
      trackedAt: Date.parse("2026-01-01T09:00:00Z"),
      projection: {
        batchId: "batch-1",
        status: "running",
        items: [
          {
            itemId: "import-1",
            clientId: "client-1",
            chapterNumber: 3,
            filename: "three.zip",
            chapterId: "c3",
            uploadId: "upload-1",
            status: "uploading" as const,
            errorCode: null,
            resolution: "created" as const,
            warnings: [],
          },
        ],
      },
    };
    const early = mergeUploadCenterRecords({
      operations: [],
      batches: [batch],
    });
    expect(early).toHaveLength(1);
    expect(early[0]?.ephemeral).toBe(true);
    const caughtUp = mergeUploadCenterRecords({
      operations: [
        operation({ id: "import-1", kind: "chapter_import", chapterNumber: 3 }),
      ],
      batches: [batch],
    });
    expect(caughtUp).toHaveLength(1);
    expect(caughtUp[0]?.ephemeral).toBe(false);
    expect(caughtUp[0]?.createdAt).toBe(
      operation({ id: "import-1", kind: "chapter_import", chapterNumber: 3 })
        .createdAt,
    );
  });

  it("uses one global deterministic ordering for all operation kinds", () => {
    const operations = [
      "chapter_import",
      "chapter_upload",
      "chapter_replacement",
      "image_replacement",
    ].map((kind, index) =>
      operation({
        id: `op-${index}`,
        kind: kind as BackgroundUploadOperation["kind"],
        createdAt: `2026-01-01T10:0${index}:00Z`,
      }),
    );
    expect(
      mergeUploadCenterRecords({ operations, batches: [] }).map(
        (row) => row.id,
      ),
    ).toEqual(["op-3", "op-2", "op-1", "op-0"]);
  });

  it("persists terminal per-operation dismissals with user scope and fingerprint invalidation", () => {
    expect(uploadCenterDismissalStorageKey("user-a")).not.toBe(
      uploadCenterDismissalStorageKey("user-b"),
    );
    expect(uploadQueueStorageKey("user-a")).not.toBe(
      uploadQueueStorageKey("user-b"),
    );
    const ready = record();
    const dismissed = [
      {
        operationId: ready.id,
        fingerprint: ready.outcomeFingerprint,
        dismissedAt: Date.now(),
      },
    ];
    expect(isUploadOutcomeDismissed(ready, dismissed)).toBe(true);
    expect(
      isUploadOutcomeDismissed(
        record({ status: "processing", updatedAt: "2026-01-01T12:00:00Z" }),
        dismissed,
      ),
    ).toBe(false);
    expect(
      isUploadOutcomeDismissed(
        record({ status: "ready", updatedAt: "2026-01-01T12:00:00Z" }),
        dismissed,
      ),
    ).toBe(false);
    expect(
      isUploadOutcomeDismissed(record({ status: "rejected" }), [
        {
          operationId: "op-1",
          fingerprint: "op-1:ready:2026-01-01T11:00:00.000Z",
          dismissedAt: 10,
        },
      ]),
    ).toBe(false);
  });

  it("keeps dismissal fingerprints stable after outcome timestamps are persisted", () => {
    const original = record({
      status: "ready",
      completedAt: "2026-01-01T10:30:00Z",
      updatedAt: "2026-01-01T10:30:00Z",
    });
    const later = record({
      status: "ready",
      completedAt: "2026-01-01T10:30:00Z",
      updatedAt: "2026-01-01T10:35:00Z",
    });
    expect(later.outcomeFingerprint).toBe(original.outcomeFingerprint);
  });

  it("sanitizes malformed, old and excess dismissal data", () => {
    expect(sanitizeDismissedUploadOutcomes("bad", Date.now())).toEqual([]);
    const now = 20 * 24 * 60 * 60 * 1000;
    const result = sanitizeDismissedUploadOutcomes(
      Array.from({ length: 510 }, (_, index) => ({
        operationId: `${index}`,
        fingerprint: `${index}:ready:x`,
        dismissedAt: now - index * 1000,
      })),
      now,
    );
    expect(result).toHaveLength(500);
    expect(result[0]?.operationId).toBe("0");
    expect(result.some((entry) => entry.operationId === "509")).toBe(false);
    expect(
      sanitizeDismissedUploadOutcomes(
        [
          {
            operationId: "old",
            fingerprint: "x",
            dismissedAt: now - 8 * 24 * 60 * 60 * 1000,
          },
        ],
        now,
      ),
    ).toEqual([]);
  });

  it("keeps historical warning thresholds optional and formats known measurements", () => {
    expect(
      mediaWarningPresentation({
        code: "large-file",
        filename: "02.webp",
        sizeBytes: 6_815_744,
        thresholdBytes: 5 * 1024 * 1024,
      }),
    ).toEqual({ title: "Archivo grande", actual: "6.5 MB", threshold: "5 MB" });
    expect(
      mediaWarningPresentation({
        code: "tall-image",
        filename: "03.webp",
        height: 13_420,
      }),
    ).toEqual({ title: "Imagen muy alta", actual: "13 420 px" });
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

  it("maps ready, warning, rejected, retry exhausted and technical failure outcomes", () => {
    expect(uploadOutcomeMessage(record()).title).toBe("Carga completada");
    expect(uploadOutcomeMessage(record({ warningCount: 2 })).title).toBe(
      "Carga completada con advertencias",
    );
    expect(uploadOutcomeMessage(record({ status: "rejected" })).title).toBe(
      "Carga rechazada",
    );
    expect(
      uploadOutcomeMessage(record({ status: "retry_exhausted" })).title,
    ).toBe("Carga interrumpida");
    expect(
      uploadOutcomeMessage(record({ status: "terminal_failed" })).title,
    ).toBe("La carga no pudo completarse");
  });

  it("does not request a validation report before admission or for image replacements", () => {
    expect(
      canLoadValidationReport(
        record({ kind: "chapter_upload", status: "uploading" }),
      ),
    ).toBe(false);
    expect(
      canLoadValidationReport(
        record({ kind: "chapter_import", status: "pending_upload" }),
      ),
    ).toBe(false);
    expect(
      canLoadValidationReport(
        record({ kind: "chapter_replacement", status: "uploading" }),
      ),
    ).toBe(false);
    expect(
      canLoadValidationReport(
        record({ kind: "image_replacement", status: "ready" }),
      ),
    ).toBe(false);
    expect(canLoadValidationReport(record({ status: "rejected" }))).toBe(true);
    expect(
      canLoadValidationReport(record({ status: "ready", warningCount: 1 })),
    ).toBe(true);
    expect(
      canLoadValidationReport(
        record({ status: "failed", failureStage: "storage" }),
      ),
    ).toBe(false);
    expect(
      canLoadValidationReport(
        record({ status: "failed", failureStage: "processing" }),
      ),
    ).toBe(true);
  });

  it("uses operation-specific copy for successful outcomes", () => {
    expect(uploadOutcomeMessage(record({ kind: "chapter_upload" })).copy).toBe(
      "El capítulo se cargó correctamente.",
    );
    expect(uploadOutcomeMessage(record({ kind: "chapter_import" })).copy).toBe(
      "El capítulo se cargó correctamente.",
    );
    expect(
      uploadOutcomeMessage(record({ kind: "chapter_replacement" })),
    ).toMatchObject({
      title: "Reemplazo completado",
      copy: "El capítulo se reemplazó correctamente.",
    });
    expect(
      uploadOutcomeMessage(
        record({ kind: "image_replacement", status: "completed" }),
      ),
    ).toMatchObject({
      title: "Reemplazo completado",
      copy: "La imagen se reemplazó correctamente.",
    });
  });

  it("keeps row summaries compact and reports batch outcomes once", () => {
    expect(uploadCenterSummary(record({ warningCount: 14 }))).toEqual({
      label: "Completada con 14 advertencias",
      tone: "warning",
    });
    expect(
      uploadCenterSummary(record({ status: "rejected", issueCount: 4 })),
    ).toEqual({
      label: "Carga rechazada · 4 problemas",
      tone: "danger",
    });
    expect(
      uploadCenterSummary(
        record({ status: "rejected", errorCode: "IMAGE_HEIGHT_EXCEEDED" }),
      ),
    ).toEqual({ label: "Carga rechazada", tone: "danger" });
    expect(
      uploadBatchOutcomePresentation({
        completed: 8,
        warnings: 2,
        rejected: 1,
        failed: 0,
      }),
    ).toMatchObject({
      title: "Carga masiva completada",
      copy: "8 capítulos completados · 2 con advertencias · 1 rechazado",
    });
  });

  it("presents contextual individual result dialog outcomes", () => {
    expect(
      uploadResultPresentation(record({ kind: "chapter_upload" })),
    ).toMatchObject({
      title: "Carga completada",
      copy: "El capítulo se cargó correctamente.",
    });
    expect(
      uploadResultPresentation(record({ kind: "chapter_import" })),
    ).toMatchObject({
      title: "Carga completada",
      copy: "El capítulo se cargó correctamente.",
    });
    expect(
      uploadResultPresentation(record({ kind: "chapter_replacement" })),
    ).toMatchObject({
      title: "Reemplazo completado",
      copy: "El capítulo se reemplazó correctamente.",
    });
    expect(
      uploadResultPresentation(
        record({ kind: "image_replacement", status: "completed" }),
      ),
    ).toMatchObject({
      title: "Reemplazo completado",
      copy: "La imagen se reemplazó correctamente.",
    });
    expect(
      uploadResultPresentation(record({ status: "rejected", issueCount: 3 }))
        .copy,
    ).toContain("3 problemas");
  });

  it("announces only observed transitions once and preserves FIFO with a three notice limit", () => {
    const ready = operation({ id: "ready-1" });
    const records = new Map([[ready.id, record({ id: ready.id })]]);
    const initial = observeUploadOutcomeTransitions({
      operations: [ready],
      recordsById: records,
      previousStatuses: null,
      announcedKeys: new Set(),
    });
    expect(initial.notices).toEqual([]);
    const announced = new Set<string>();
    const first = observeUploadOutcomeTransitions({
      operations: [ready],
      recordsById: records,
      previousStatuses: new Map([[ready.id, "processing:0"]]),
      announcedKeys: announced,
    });
    const repeated = observeUploadOutcomeTransitions({
      operations: [ready],
      recordsById: records,
      previousStatuses: new Map([[ready.id, "processing:0"]]),
      announcedKeys: announced,
    });
    expect(first.notices).toHaveLength(1);
    expect(repeated.notices).toHaveLength(0);
    const newlyDiscoveredRejected = operation({
      id: "rejected-1",
      kind: "chapter_upload",
      status: "rejected",
      errorCode: "IMAGE_SIZE_EXCEEDED",
    });
    const discovered = observeUploadOutcomeTransitions({
      operations: [newlyDiscoveredRejected],
      recordsById: new Map([
        [
          newlyDiscoveredRejected.id,
          record({ id: newlyDiscoveredRejected.id, status: "rejected" }),
        ],
      ]),
      previousStatuses: new Map([["earlier-operation", "processing:0"]]),
      announcedKeys: new Set(),
    });
    expect(discovered.notices).toHaveLength(1);
    expect(discovered.notices[0]?.record.status).toBe("rejected");
    const notices = Array.from({ length: 5 }, (_, index) => ({
      key: `${index}`,
      record: record({ id: `${index}` }),
    }));
    const firstPage = fillOutcomeNoticeSlots([], notices);
    expect(firstPage.visible.map((notice) => notice.key)).toEqual([
      "0",
      "1",
      "2",
    ]);
    expect(firstPage.pending.map((notice) => notice.key)).toEqual(["3", "4"]);
    const afterDismiss = fillOutcomeNoticeSlots(
      firstPage.visible.slice(1),
      firstPage.pending,
    );
    expect(afterDismiss.visible.map((notice) => notice.key)).toEqual([
      "1",
      "2",
      "3",
    ]);
    expect(afterDismiss.pending.map((notice) => notice.key)).toEqual(["4"]);
  });
});
