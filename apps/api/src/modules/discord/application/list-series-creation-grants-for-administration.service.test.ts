import { describe, expect, it, vi } from "vitest";
import {
  DiscordGrantAdministrationForbiddenError,
  ListSeriesCreationGrantsForAdministrationService,
} from "./list-series-creation-grants-for-administration.service.js";

describe("ListSeriesCreationGrantsForAdministrationService", () => {
  it("requires the grant-read capability before querying grants", async () => {
    const select = vi.fn();
    const authorization = {
      authorize: vi.fn().mockResolvedValue({ allowed: false }),
    };
    const service = new ListSeriesCreationGrantsForAdministrationService(
      { select } as never,
      authorization as never,
    );

    await expect(
      service.execute({ userId: "actor", sessionId: "session" }, { limit: 25 }),
    ).rejects.toBeInstanceOf(DiscordGrantAdministrationForbiddenError);

    expect(select).not.toHaveBeenCalled();
  });
});
