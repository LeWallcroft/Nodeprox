import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "../../../authorization/domain/permissions.js";
import { GetOverviewQuery } from "./get-overview.query.js";
import type { OverviewReadPort } from "../ports/overview-read.port.js";

function repository(): OverviewReadPort {
  return {
    getTotals: vi.fn().mockResolvedValue({
      series: 0,
      chapters: 0,
      images: 0,
      activeUsers: 4,
    }),
    getRecentActivity: vi.fn().mockResolvedValue(
      Array.from({ length: 5 }, (_, index) => ({
        id: String(index),
        actor: { id: "actor", label: "Actor" },
        action: "settings.updated",
        resourceType: "product-settings",
        resourceLabel: null,
        occurredAt: "2026-08-29T00:00:00.000Z",
      })),
    ),
    getStorageUsage: vi.fn().mockResolvedValue({
      usedBytes: 1024,
      quotaBytes: null,
      source: "database",
    }),
    getActivity7d: vi.fn().mockResolvedValue([
      { date: "2026-08-29", series: 0, chapters: 0 },
    ]),
  };
}

describe("GetOverviewQuery", () => {
  it("returns the complete administrative projection and requests five activity events", async () => {
    const read = repository();
    const query = new GetOverviewQuery(read);

    const result = await query.execute({
      capabilities: [
        PERMISSIONS.ADMIN_USERS_MANAGE,
        PERMISSIONS.ADMIN_SYSTEM_MANAGE,
      ],
    });

    expect(result.totals.activeUsers).toBe(4);
    expect(result.recentActivity).toHaveLength(5);
    expect(read.getRecentActivity).toHaveBeenCalledWith(5);
    expect(result.system.storage).toEqual({
      usedBytes: 1024,
      quotaBytes: null,
      source: "database",
    });
    expect(result.system.activity7d).toEqual([
      { date: "2026-08-29", series: 0, chapters: 0 },
    ]);
  });

  it("hides the global user count without the users capability", async () => {
    const query = new GetOverviewQuery(repository());

    await expect(
      query.execute({ capabilities: [PERMISSIONS.ADMIN_SYSTEM_MANAGE] }),
    ).resolves.toMatchObject({ totals: { activeUsers: null } });
  });

  it("does not request audit activity without the system capability", async () => {
    const read = repository();
    const query = new GetOverviewQuery(read);

    await expect(
      query.execute({ capabilities: [PERMISSIONS.SERIES_READ] }),
    ).resolves.toMatchObject({ recentActivity: [] });
    expect(read.getRecentActivity).not.toHaveBeenCalled();
  });

  it("keeps a zero-valued repository projection valid", async () => {
    const read = repository();
    vi.mocked(read.getTotals).mockResolvedValue({
      series: 0,
      chapters: 0,
      images: 0,
      activeUsers: 0,
    });
    const query = new GetOverviewQuery(read);

    await expect(
      query.execute({
        capabilities: [
          PERMISSIONS.ADMIN_USERS_MANAGE,
          PERMISSIONS.ADMIN_SYSTEM_MANAGE,
        ],
      }),
    ).resolves.toMatchObject({
      totals: { series: 0, chapters: 0, images: 0, activeUsers: 0 },
      system: { overallStatus: "operational" },
    });
  });
});
