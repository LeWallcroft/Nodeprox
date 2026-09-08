import { describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "../../apps/api/src/modules/authorization/domain/permissions.js";
import { SeriesService } from "../../apps/api/src/modules/series/application/services/series.service.js";

const context = {
  userId: "00000000-0000-4000-8000-000000000001",
  sessionId: "session",
};

function fixture(role: "admin" | "gestor" | "uploader") {
  const series = {
    createWithCreationPolicy: vi.fn().mockResolvedValue({
      outcome: "created",
      series: {
        id: "series",
        title: "Title",
        slug: "title",
        description: null,
        coverUrl: null,
        discordChannelId: null,
        discordChannelNameSnapshot: null,
        principalUploader: null,
        createdBy: context.userId,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    }),
  };
  const authorization = {
    authorize: vi
      .fn()
      .mockImplementation(async (_context: unknown, permission: string) => ({
        allowed:
          role === "uploader"
            ? permission === PERMISSIONS.SERIES_CREATE_WITH_GRANT
            : permission === PERMISSIONS.SERIES_CREATE,
        role,
      })),
  };
  const service = new SeriesService(
    series as never,
    {} as never,
    authorization as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { series, authorization, service };
}

describe("BOT-M1A Series creation policy", () => {
  it("requires the grant capability for an uploader and delegates consumption atomically", async () => {
    const target = fixture("uploader");
    await target.service.create(context, {
      title: "Title",
      grantId: "00000000-0000-4000-8000-000000000002",
    });
    expect(target.authorization.authorize).toHaveBeenNthCalledWith(
      2,
      context,
      PERMISSIONS.SERIES_CREATE_WITH_GRANT,
    );
    expect(target.series.createWithCreationPolicy).toHaveBeenCalledWith(
      expect.objectContaining({
        actorRole: "uploader",
        grantId: "00000000-0000-4000-8000-000000000002",
      }),
    );
  });

  it("requires a Discord channel only for gestor creation", async () => {
    const target = fixture("gestor");
    await target.service.create(context, {
      title: "Title",
      discordChannelId: "123",
    });
    expect(target.series.createWithCreationPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "gestor", discordChannelId: "123" }),
    );
  });

  it("does not require a grant or Discord channel for admin creation", async () => {
    const target = fixture("admin");
    await target.service.create(context, { title: "Title" });
    expect(target.series.createWithCreationPolicy).toHaveBeenCalledWith(
      expect.objectContaining({ actorRole: "admin" }),
    );
  });
});
