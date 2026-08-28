import { describe, expect, it, vi } from "vitest";
import {
  MAX_DIRECT_UPLOAD_CONCURRENCY,
  mediaWarningLabel,
  runPool,
} from "./orchestration";

describe("bulk upload orchestration", () => {
  it("never runs more than three direct uploads concurrently", async () => {
    let active = 0;
    let maximum = 0;
    const releases: (() => void)[] = [];
    const jobs = Array.from({ length: 7 }, () => async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await new Promise<void>((resolve) => releases.push(resolve));
      active -= 1;
    });
    const running = runPool(jobs);
    await vi.waitFor(() => expect(active).toBe(MAX_DIRECT_UPLOAD_CONCURRENCY));
    while (releases.length > 0 || active > 0) {
      releases.shift()?.();
      await Promise.resolve();
    }
    await running;
    expect(maximum).toBe(3);
  });

  it("keeps successful items intact when one item fails and is retried", async () => {
    const uploads = new Map<string, number>();
    const statuses = new Map<string, "ready" | "failed">();
    const upload = async (id: string, fail = false) => {
      uploads.set(id, (uploads.get(id) ?? 0) + 1);
      statuses.set(id, fail ? "failed" : "ready");
    };
    await runPool([
      () => upload("25"),
      () => upload("26", true),
      () => upload("30"),
    ]);
    await upload("26");
    expect(Object.fromEntries(uploads)).toEqual({ 25: 1, 26: 2, 30: 1 });
    expect(Object.fromEntries(statuses)).toEqual({
      25: "ready",
      26: "ready",
      30: "ready",
    });
  });

  it("renders media warnings without treating them as rejection", () => {
    expect(
      mediaWarningLabel({
        code: "wide-image",
        filename: "01.jpg",
        width: 5000,
      }),
    ).toContain("01.jpg");
  });
});
