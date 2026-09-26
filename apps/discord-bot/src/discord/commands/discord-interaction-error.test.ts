import { describe, expect, it } from "vitest";
import { DiscordInteractionError } from "./discord-interaction-error.js";

describe("DiscordInteractionError unauthorized context", () => {
  it.each([
    [
      "series_grant.issue",
      "No tienes permisos para autorizar la creación de Series.",
    ],
    [
      "bot.configure",
      "No tienes permisos para administrar la configuración del bot.",
    ],
    [
      "series_grant.invalidate",
      "No tienes permisos para invalidar autorizaciones.",
    ],
  ] as const)("maps %s to its operation-specific copy", (operation, copy) => {
    expect(
      new DiscordInteractionError("unauthorized", undefined, operation)
        .userMessage,
    ).toBe(copy);
  });
});
