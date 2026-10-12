import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({ status: vi.fn(), trigger: vi.fn() }));

vi.mock("../../../lib/domains/discord/profile-sync-hooks", () => ({
  discordProfileSyncKey: ["admin", "discord", "profile-sync"],
  useDiscordProfileSyncStatus: mocked.status,
  useTriggerDiscordProfileSync: mocked.trigger,
}));

import { discordProfileSyncKey } from "../../../lib/domains/discord/profile-sync-hooks";
import { DiscordProfileSyncCard } from "./discord-profile-sync-card";

describe("Discord profile sync card ownership", () => {
  beforeEach(() => {
    mocked.trigger.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      mutateAsync: vi.fn(),
    });
    mocked.status.mockReturnValue({
      isPending: false,
      isError: false,
      error: null,
      data: {
        linkedUsers: 14,
        missingAvatar: 2,
        staleProfiles: 3,
        oldestSyncedAt: "2026-10-11T18:00:00.000Z",
        syncRunning: false,
      },
    });
  });

  it("shows sync status and is owned by Integrations", () => {
    const markup = renderToStaticMarkup(<DiscordProfileSyncCard />);
    expect(markup).toContain("Perfiles vinculados");
    expect(markup).toContain("Cuentas vinculadas");
    expect(markup).toContain(">14</dd>");
    expect(markup).toContain("Avatares faltantes");
    expect(markup).toContain("Perfiles pendientes de refresco");
    expect(markup).toContain("Sincronizar perfiles de Discord");

    const workspace = readFileSync(
      resolve(
        process.cwd(),
        "apps/web/components/domains/settings/settings-workspace.tsx",
      ),
      "utf8",
    );
    expect(workspace.indexOf("<DiscordProfileSyncCard />")).toBeGreaterThan(
      workspace.indexOf('{selected === "integrations"'),
    );
  });

  it("uses a Discord bounded-context query key", () => {
    expect(discordProfileSyncKey).toEqual(["admin", "discord", "profile-sync"]);
  });
});
