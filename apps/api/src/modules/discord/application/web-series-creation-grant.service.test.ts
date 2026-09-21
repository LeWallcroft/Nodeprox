import { describe, expect, it, vi } from "vitest";
import {
  WebGrantForbiddenError,
  WebSeriesCreationGrantService,
} from "./web-series-creation-grant.service.js";

describe("WebSeriesCreationGrantService", () => {
  const actor = { userId: "actor", sessionId: "session" };

  it("requires the corresponding capabilities", async () => {
    const db = { transaction: vi.fn(), select: vi.fn() };
    const authorization = {
      authorize: vi.fn().mockResolvedValue({ allowed: false }),
    };
    const service = new WebSeriesCreationGrantService(
      db as never,
      authorization as never,
      { append: vi.fn() } as never,
    );

    await expect(
      service.issue(actor, { targetUserId: "target" }),
    ).rejects.toBeInstanceOf(WebGrantForbiddenError);
    await expect(service.invalidate(actor, "grant")).rejects.toBeInstanceOf(
      WebGrantForbiddenError,
    );
    await expect(service.history(actor, "grant")).rejects.toBeInstanceOf(
      WebGrantForbiddenError,
    );
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.select).not.toHaveBeenCalled();
  });
});
