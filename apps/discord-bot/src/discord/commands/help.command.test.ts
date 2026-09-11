import { describe, expect, it, vi } from "vitest";
import { HelpCommand } from "./help.command.js";

describe("/ayuda", () => {
  it("is public and lists only available commands", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    await new HelpCommand().execute({ reply } as never);
    const response = reply.mock.calls[0]?.[0];
    expect(response.flags).toBeUndefined();
    expect(response.embeds).toHaveLength(1);
    const fields = response.embeds[0].data.fields;
    expect(fields.map((field: { name: string }) => field.name)).toEqual([
      "/vincular",
      "/autorizar-serie",
      "/panel",
      "/ayuda",
    ]);
  });
});
