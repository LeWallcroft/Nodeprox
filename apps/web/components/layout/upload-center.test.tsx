import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isActiveItem, isReadyBatch } from "./upload-center";

describe("Upload Center presentation", () => {
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
    expect(center).toContain("No hay cargas activas");
    expect(center).not.toContain("DELETE");
    expect(provider).toContain("refresh(): Promise<void>");
    expect(provider).toContain(
      "tracked.map((batch) => refreshBatch(batch.batchId))",
    );
  });
});
