import { describe, expect, it, vi } from "vitest";
import { AuthorizeSeriesWorkflow } from "./authorize-series.workflow.js";
import { DiscordInteractionError } from "./discord-interaction-error.js";

const integration = {
  guildId: "guild",
  controlChannelId: "channel",
  enabled: true,
  authorizedRoles: [
    { roleId: "issuer", capabilities: ["series_grant.issue"] as const },
  ],
};

function commandInteraction(roleIds = ["issuer"]) {
  const target = {
    id: "command-interaction",
    guildId: "guild",
    channelId: "channel",
    user: { id: "actor" },
    member: { roles: roleIds },
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    deferred: false,
    replied: false,
    deferReply: vi.fn().mockImplementation(async () => {
      target.deferred = true;
    }),
  };
  return target;
}

describe("/autorizar-serie workflow", () => {
  it.each([{ roleIds: [] }, { roleIds: ["invalidator"] }])(
    "fails closed before showing the selector when the actor lacks issue capability",
    async ({ roleIds }) => {
      const api = {
        getIntegration: vi.fn().mockResolvedValue(integration),
        issueSeriesCreationGrant: vi.fn(),
        confirmLink: vi.fn(),
      };
      const workflow = new AuthorizeSeriesWorkflow(api);
      const target = commandInteraction(roleIds);
      await expect(workflow.execute(target as never)).rejects.toMatchObject({
        failure: "unauthorized",
        userMessage: "No tienes permisos para autorizar la creación de Series.",
      });
      expect(target.deferReply).toHaveBeenCalledOnce();
      expect(target.reply).not.toHaveBeenCalled();
      expect(target.editReply).not.toHaveBeenCalled();
      expect(api.issueSeriesCreationGrant).not.toHaveBeenCalled();
      expect(
        (workflow as unknown as { workflows: Map<string, unknown> }).workflows,
      ).toHaveLength(0);
    },
  );

  it("builds and sends the initial selector for the configured issuing role", async () => {
    const api = {
      getIntegration: vi.fn().mockResolvedValue({
        ...integration,
        authorizedRoles: [
          {
            roleId: "1508658475209723985",
            capabilities: ["series_grant.issue"] as const,
          },
        ],
      }),
      issueSeriesCreationGrant: vi.fn(),
      confirmLink: vi.fn(),
    };
    const workflow = new AuthorizeSeriesWorkflow(api);
    const target = commandInteraction(["1508658475209723985"]);

    await workflow.execute(target as never);

    expect(target.deferReply).toHaveBeenCalledOnce();
    expect(target.editReply).toHaveBeenCalledOnce();
    const response = target.editReply.mock.calls[0]?.[0];
    expect(response.components[0].components[0].data.custom_id).toMatch(
      /^nodeprox:series-grant:target:[a-f0-9-]{36}$/,
    );
    expect(api.issueSeriesCreationGrant).not.toHaveBeenCalled();
    expect(
      (workflow as unknown as { workflows: Map<string, unknown> }).workflows,
    ).toHaveLength(1);
  });

  it("keeps stale workflow errors distinct from authorization failures", async () => {
    const workflow = new AuthorizeSeriesWorkflow({
      getIntegration: vi.fn(),
      issueSeriesCreationGrant: vi.fn(),
      confirmLink: vi.fn(),
    });
    await expect(
      workflow.executeComponent({
        customId:
          "nodeprox:series-grant:confirm:00000000-0000-0000-0000-000000000000",
      } as never),
    ).rejects.toEqual(expect.any(DiscordInteractionError));
    await expect(
      workflow.executeComponent({
        customId:
          "nodeprox:series-grant:confirm:00000000-0000-0000-0000-000000000000",
      } as never),
    ).rejects.toMatchObject({
      failure: "stale_workflow",
      userMessage: "Esta acción ya no es válida.",
    });
  });

  it("classifies a disabled integration separately", async () => {
    const api = {
      getIntegration: vi.fn().mockResolvedValue({
        ...integration,
        enabled: false,
      }),
      issueSeriesCreationGrant: vi.fn(),
      confirmLink: vi.fn(),
    };
    const workflow = new AuthorizeSeriesWorkflow(api);
    await expect(
      workflow.execute(commandInteraction() as never),
    ).rejects.toMatchObject({
      failure: "integration_disabled",
      userMessage: "La integración de Discord no está habilitada.",
    });
    expect(api.issueSeriesCreationGrant).not.toHaveBeenCalled();
  });

  it("uses the selected Discord identity and emits a grant only after confirmation", async () => {
    const api = {
      getIntegration: vi.fn().mockResolvedValue(integration),
      issueSeriesCreationGrant: vi.fn().mockResolvedValue({
        id: "grant",
        displayCode: "NPX-SER-OPAQUE",
        reference: "Proyecto Alpha",
        status: "available",
        issuedAt: "2026-09-08T00:00:00.000Z",
        targetUser: { id: "internal-user", username: "user" },
      }),
      confirmLink: vi.fn(),
    };
    const workflow = new AuthorizeSeriesWorkflow(api);
    const command = commandInteraction();
    await workflow.execute(command as never);
    const targetCustomId =
      command.editReply.mock.calls[0]?.[0].components[0].components[0].data
        .custom_id;
    const select = {
      customId: targetCustomId,
      values: ["target-discord"],
      user: { id: "actor" },
      guildId: "guild",
      channelId: "channel",
      isUserSelectMenu: () => true,
      isButton: () => false,
      isModalSubmit: () => false,
      update: vi.fn().mockResolvedValue(undefined),
    };
    await workflow.executeComponent(select as never);
    const continueCustomId =
      select.update.mock.calls[0]?.[0].components[0].components[0].data
        .custom_id;
    const button = {
      customId: continueCustomId,
      user: { id: "actor" },
      guildId: "guild",
      channelId: "channel",
      isUserSelectMenu: () => false,
      isButton: () => true,
      isModalSubmit: () => false,
      showModal: vi.fn().mockResolvedValue(undefined),
    };
    await workflow.executeComponent(button as never);
    const referenceCustomId =
      button.showModal.mock.calls[0]?.[0].data.custom_id;
    const modal = {
      customId: referenceCustomId,
      user: { id: "actor" },
      guildId: "guild",
      channelId: "channel",
      isUserSelectMenu: () => false,
      isButton: () => false,
      isModalSubmit: () => true,
      fields: { getTextInputValue: vi.fn().mockReturnValue("Proyecto Alpha") },
      reply: vi.fn().mockResolvedValue(undefined),
    };
    await workflow.executeComponent(modal as never);
    const confirmCustomId =
      modal.reply.mock.calls[0]?.[0].components[0].components[0].data.custom_id;
    const confirm = {
      id: "final-interaction",
      customId: confirmCustomId,
      user: { id: "actor" },
      guildId: "guild",
      channelId: "channel",
      member: { roles: ["issuer"] },
      isUserSelectMenu: () => false,
      isButton: () => true,
      isModalSubmit: () => false,
      update: vi.fn().mockResolvedValue(undefined),
      deferred: false,
      replied: false,
      deferUpdate: vi.fn().mockImplementation(async () => {
        confirm.deferred = true;
      }),
      editReply: vi.fn().mockResolvedValue(undefined),
    };
    await workflow.executeComponent(confirm as never);
    expect(api.issueSeriesCreationGrant).toHaveBeenCalledWith({
      targetDiscordId: "target-discord",
      reference: "Proyecto Alpha",
      actorDiscordId: "actor",
      actorRoleIds: ["issuer"],
      guildId: "guild",
      channelId: "channel",
      interactionId: "final-interaction",
    });
    expect(confirm.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("NPX-SER-OPAQUE"),
      }),
    );
  });

  it("cancels without calling the grant API", async () => {
    const api = {
      getIntegration: vi.fn().mockResolvedValue(integration),
      issueSeriesCreationGrant: vi.fn(),
      confirmLink: vi.fn(),
    };
    const workflow = new AuthorizeSeriesWorkflow(api);
    const command = commandInteraction();
    await workflow.execute(command as never);
    const cancelCustomId =
      command.editReply.mock.calls[0]?.[0].components[1].components[0].data
        .custom_id;
    const cancel = {
      customId: cancelCustomId,
      user: { id: "actor" },
      guildId: "guild",
      channelId: "channel",
      isUserSelectMenu: () => false,
      isButton: () => true,
      isModalSubmit: () => false,
      update: vi.fn().mockResolvedValue(undefined),
    };
    await workflow.executeComponent(cancel as never);
    expect(api.issueSeriesCreationGrant).not.toHaveBeenCalled();
    expect(cancel.update).toHaveBeenCalledWith({
      content: "Autorización cancelada.",
      components: [],
    });
  });
});
