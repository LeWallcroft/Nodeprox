import { describe, expect, it, vi } from "vitest";
import { HelpCommand } from "./help.command.js";

describe("/ayuda", () => {
  it("is ephemeral and lists only M1B commands", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await new HelpCommand().execute({ reply } as never);
    expect(reply).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
    );
    expect(reply.mock.calls[0]?.[0].content).toContain("/vincular");
    expect(reply.mock.calls[0]?.[0].content).toContain("/ayuda");
    expect(reply.mock.calls[0]?.[0].content).not.toContain("/autorizar-serie");
  });
});
