import { describe, expect, it } from "vitest";
import { presentAuthorizeSeries } from "./authorize-series.presenter.js";

describe("presentAuthorizeSeries", () => {
  it("renders the completed workflow panel without acting as notification transport", () => {
    const completed = presentAuthorizeSeries({
      state: "completed",
      initiatedByDiscordUserId: "22345678901234567",
      targetDiscordId: "12345678901234567",
      reference: null,
      displayCode: "NPX-SER-OPAQUE",
    });
    expect(completed).not.toHaveProperty("content");
    expect(completed).not.toHaveProperty("allowedMentions");
    expect(completed.embeds).toHaveLength(1);
    expect(completed.components).toEqual([]);
  });

  it("does not mention users before completion", () => {
    const pending = presentAuthorizeSeries({
      state: "pending-confirmation",
      workflowId: "workflow-1",
      initiatedByDiscordUserId: "22345678901234567",
      targetDiscordId: "12345678901234567",
      reference: null,
    });
    expect(pending).not.toHaveProperty("content");
    expect(pending).not.toHaveProperty("allowedMentions");
  });
});
