import { MessageFlags } from "discord.js";
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

function api() {
  return {
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
}

function commandInteraction(roleIds = ["issuer"]) {
  return {
    id: "command-interaction",
    guildId: "guild",
    channelId: "channel",
    user: { id: "actor" },
    member: { roles: roleIds },
    reply: vi.fn().mockResolvedValue(undefined),
    deferred: false,
    replied: false,
  };
}

function component(customId: string, shape: "select" | "button" | "modal") {
  const target = {
    id: `${shape}-interaction`,
    customId,
    values: shape === "select" ? ["target-discord"] : [],
    guildId: "guild",
    channelId: "channel",
    user: { id: "actor" },
    member: { roles: ["issuer"] },
    isUserSelectMenu: () => shape === "select",
    isButton: () => shape === "button",
    isModalSubmit: () => shape === "modal",
    isFromMessage: () => shape === "modal",
    fields: { getTextInputValue: vi.fn().mockReturnValue("Proyecto Alpha") },
    channel: {
      isSendable: () => true,
      send: vi.fn().mockResolvedValue(undefined),
    },
    update: vi.fn().mockResolvedValue(undefined),
    showModal: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    deferred: false,
    replied: false,
    deferUpdate: vi.fn(),
  };
  target.deferUpdate.mockImplementation(async () => {
    target.deferred = true;
  });
  return target;
}

function customId(payload: unknown, row: number, item: number) {
  const panel = (
    payload as {
      components: Array<{ components: Array<{ data: { custom_id: string } }> }>;
    }
  ).components[row];
  const control = panel?.components[item];
  if (!control) throw new Error("missing-workflow-control");
  return control.data.custom_id;
}

describe("/autorizar-serie workflow", () => {
  it("shows the embedded authorization workflow only to the issuing actor", async () => {
    const client = api();
    const workflow = new AuthorizeSeriesWorkflow(client);
    const command = commandInteraction();

    await workflow.execute(command as never);

    expect(command.reply).toHaveBeenCalledOnce();
    const response = command.reply.mock.calls[0]?.[0];
    expect(response.embeds).toHaveLength(1);
    expect(response.flags).toBe(MessageFlags.Ephemeral);
    expect(customId(response, 0, 0)).toMatch(
      /^nodeprox:series-grant:[a-f0-9-]{36}:target$/,
    );
  });

  it.each([{ roleIds: [] }, { roleIds: ["invalidator"] }])(
    "rejects an actor without issue capability before creating a public workflow",
    async ({ roleIds }) => {
      const workflow = new AuthorizeSeriesWorkflow(api());
      await expect(
        workflow.execute(commandInteraction(roleIds) as never),
      ).rejects.toMatchObject({
        failure: "unauthorized",
      });
      expect(
        (workflow as unknown as { workflows: Map<string, unknown> }).workflows,
      ).toHaveLength(0);
    },
  );

  it("updates the private panel and posts authorization details to the control channel", async () => {
    const client = api();
    const workflow = new AuthorizeSeriesWorkflow(client);
    const command = commandInteraction();
    await workflow.execute(command as never);
    const selector = component(
      customId(command.reply.mock.calls[0]?.[0], 0, 0),
      "select",
    );
    await workflow.executeComponent(selector as never);

    const continueButton = component(
      customId(selector.update.mock.calls[0]?.[0], 0, 0),
      "button",
    );
    await workflow.executeComponent(continueButton as never);
    const modal = component(
      continueButton.showModal.mock.calls[0]?.[0].data.custom_id,
      "modal",
    );
    await workflow.executeComponent(modal as never);
    expect(modal.followUp).not.toHaveBeenCalled();
    expect(modal.channel.send).not.toHaveBeenCalled();

    const confirmButton = component(
      customId(modal.update.mock.calls[0]?.[0], 0, 0),
      "button",
    );
    confirmButton.id = "final-interaction";
    await workflow.executeComponent(confirmButton as never);

    expect(client.issueSeriesCreationGrant).toHaveBeenCalledOnce();
    expect(confirmButton.editReply).toHaveBeenCalledWith(
      expect.objectContaining({
        embeds: expect.any(Array),
        components: [],
      }),
    );
    expect(confirmButton.followUp).not.toHaveBeenCalled();
    expect(confirmButton.channel.send).toHaveBeenCalledOnce();
    const notification = confirmButton.channel.send.mock.calls[0]?.[0];
    expect(notification.content).toBe("<@target-discord>");
    expect(notification.allowedMentions).toEqual({
      parse: [],
      users: ["target-discord"],
    });
    expect(notification.embeds[0]?.data.title).toBe(
      "🎉 ¡Ya puedes crear una Serie!",
    );
    expect(JSON.stringify(notification)).not.toContain("NPX-SER-OPAQUE");
    expect(notification.components[0]?.components[0]?.data.url).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects another actor without mutating the public panel", async () => {
    const workflow = new AuthorizeSeriesWorkflow(api());
    const command = commandInteraction();
    await workflow.execute(command as never);
    const select = component(
      customId(command.reply.mock.calls[0]?.[0], 0, 0),
      "select",
    );
    select.user = { id: "other" };

    await expect(
      workflow.executeComponent(select as never),
    ).rejects.toMatchObject({
      userMessage: "No tienes permisos para interactuar con esta acción.",
    });
    expect(select.update).not.toHaveBeenCalled();
  });

  it("cancels without calling the grant API", async () => {
    const client = api();
    const workflow = new AuthorizeSeriesWorkflow(client);
    const command = commandInteraction();
    await workflow.execute(command as never);
    const cancel = component(
      customId(command.reply.mock.calls[0]?.[0], 1, 0),
      "button",
    );

    await workflow.executeComponent(cancel as never);

    expect(client.issueSeriesCreationGrant).not.toHaveBeenCalled();
    expect(cancel.update).toHaveBeenCalledWith(
      expect.objectContaining({ components: [] }),
    );
    expect(cancel.followUp).not.toHaveBeenCalled();
    expect(cancel.channel.send).not.toHaveBeenCalled();
  });

  it("does not notify the target when grant issuance fails", async () => {
    const client = api();
    client.issueSeriesCreationGrant.mockRejectedValue(new Error("unavailable"));
    const workflow = new AuthorizeSeriesWorkflow(client);
    const command = commandInteraction();
    await workflow.execute(command as never);
    const selector = component(
      customId(command.reply.mock.calls[0]?.[0], 0, 0),
      "select",
    );
    await workflow.executeComponent(selector as never);
    const continueButton = component(
      customId(selector.update.mock.calls[0]?.[0], 0, 0),
      "button",
    );
    await workflow.executeComponent(continueButton as never);
    const modal = component(
      continueButton.showModal.mock.calls[0]?.[0].data.custom_id,
      "modal",
    );
    await workflow.executeComponent(modal as never);
    const confirmButton = component(
      customId(modal.update.mock.calls[0]?.[0], 0, 0),
      "button",
    );

    await expect(
      workflow.executeComponent(confirmButton as never),
    ).rejects.toMatchObject({
      userMessage:
        "No se pudo crear la autorización. Inténtalo nuevamente más tarde.",
    });

    expect(confirmButton.editReply).not.toHaveBeenCalled();
    expect(confirmButton.followUp).not.toHaveBeenCalled();
    expect(confirmButton.channel.send).not.toHaveBeenCalled();
  });

  it("keeps stale workflow errors private to the component interaction", async () => {
    const workflow = new AuthorizeSeriesWorkflow(api());
    await expect(
      workflow.executeComponent({
        customId:
          "nodeprox:series-grant:00000000-0000-0000-0000-000000000000:confirm",
      } as never),
    ).rejects.toEqual(expect.any(DiscordInteractionError));
  });
});
