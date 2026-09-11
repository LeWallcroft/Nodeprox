import { describe, expect, it, vi } from "vitest";
import { OperationalPanel } from "./configuration.workflow.js";

const integration = {
  guildId: "guild",
  controlChannelId: "channel",
  enabled: true,
  authorizedRoles: [
    { roleId: "issuer", capabilities: ["series_grant.issue"] as const },
    { roleId: "administrator", capabilities: ["bot.configure"] as const },
  ],
};

function command(roleIds = ["issuer"]) {
  return {
    guildId: "guild",
    channelId: "channel",
    user: { id: "actor" },
    member: { roles: roleIds },
    reply: vi.fn().mockResolvedValue(undefined),
    deferred: false,
    replied: false,
  };
}

describe("/panel operational panel", () => {
  it("is public, read-only, and has no role selector", async () => {
    const authorizeSeries = { execute: vi.fn() };
    const panel = new OperationalPanel(
      { getIntegration: vi.fn().mockResolvedValue(integration) } as never,
      authorizeSeries as never,
    );
    const interaction = command();

    await panel.execute(interaction as never);

    const response = interaction.reply.mock.calls[0]?.[0];
    expect(response.flags).toBeUndefined();
    expect(response.embeds[0].data.title).toBe("⚙️ Panel NodeProx");
    expect(response.components[0].components).toHaveLength(2);
    expect(response.components[0].components[0].data.label).toBe(
      "Autorizar Serie",
    );
    expect(response.components[0].components[1].data.label).toBe("Ayuda");
    expect(JSON.stringify(response)).not.toContain("RoleSelectMenu");
    expect(JSON.stringify(response)).not.toContain("Guardar cambios");
  });

  it("hides authorization action for a user without issue capability", async () => {
    const panel = new OperationalPanel(
      { getIntegration: vi.fn().mockResolvedValue(integration) } as never,
      { execute: vi.fn() } as never,
    );
    const interaction = command(["administrator"]);

    await panel.execute(interaction as never);

    const components =
      interaction.reply.mock.calls[0]?.[0].components[0].components;
    expect(components).toHaveLength(1);
    expect(components[0].data.label).toBe("Ayuda");
  });

  it("delegates the authorization button to its guarded workflow", async () => {
    const authorizeSeries = { execute: vi.fn().mockResolvedValue(undefined) };
    const panel = new OperationalPanel(
      { getIntegration: vi.fn() } as never,
      authorizeSeries as never,
    );
    const interaction = {
      customId: "nodeprox:operational:authorize",
      isButton: () => true,
    };

    await panel.executeComponent(interaction as never);

    expect(authorizeSeries.execute).toHaveBeenCalledWith(interaction);
  });
});
