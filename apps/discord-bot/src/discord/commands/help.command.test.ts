import { MessageFlags } from "discord.js";
import { describe, expect, it, vi } from "vitest";
import { HelpCommand } from "./help.command.js";

describe("/ayuda", () => {
  it("is ephemeral and lists only available commands", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await new HelpCommand().execute({ reply } as never);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ flags: MessageFlags.Ephemeral }),
    );
    expect(reply.mock.calls[0]?.[0].content).toContain("/vincular");
    expect(reply.mock.calls[0]?.[0].content).toContain("/ayuda");
    expect(reply.mock.calls[0]?.[0].content).toContain("/autorizar-serie");
  });
});
