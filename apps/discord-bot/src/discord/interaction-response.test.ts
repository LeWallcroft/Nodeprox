import { MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { ephemeralPayload, respondSafely } from "./interaction-response.js";

function interaction(input: { deferred?: boolean; replied?: boolean } = {}) {
  return {
    deferred: input.deferred ?? false,
    replied: input.replied ?? false,
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
  };
}

describe("interaction response helper", () => {
  it("acknowledges an untouched interaction exactly once", async () => {
    const target = interaction();
    await respondSafely(
      target as never,
      ephemeralPayload({ content: "respuesta" }),
    );
    expect(target.reply).toHaveBeenCalledOnce();
    expect(target.reply).toHaveBeenCalledWith({
      content: "respuesta",
      flags: MessageFlags.Ephemeral,
    });
    expect(target.editReply).not.toHaveBeenCalled();
    expect(target.followUp).not.toHaveBeenCalled();
  });

  it("edits a deferred interaction without a second ACK", async () => {
    const target = interaction({ deferred: true });
    await respondSafely(
      target as never,
      ephemeralPayload({ content: "respuesta" }),
    );
    expect(target.editReply).toHaveBeenCalledWith({ content: "respuesta" });
    expect(target.reply).not.toHaveBeenCalled();
  });

  it("uses a safe follow-up after an existing reply", async () => {
    const target = interaction({ replied: true });
    await respondSafely(
      target as never,
      ephemeralPayload({ content: "respuesta" }),
    );
    expect(target.followUp).toHaveBeenCalledOnce();
    expect(target.reply).not.toHaveBeenCalled();
  });
});
