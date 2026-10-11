import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
}));

vi.mock("../../lib/domains/auth/hooks", () => ({
  useCapabilities: () => ({ data: { role: "uploader" } }),
  useLogout: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));

import { UserMenu } from "./user-menu.js";

describe("UserMenu avatar", () => {
  it("renders the linked Discord avatar from the session user", () => {
    const markup = renderToStaticMarkup(
      <UserMenu
        user={{
          id: "user-1",
          email: "reader@example.com",
          status: "active",
          discordUsername: "reader",
          displayName: "Reader Name",
          avatarUrl:
            "https://cdn.discordapp.com/avatars/12345678901234567/hash.webp",
          discordLinked: true,
        }}
      />,
    );

    expect(markup).toContain("<img");
    expect(markup).toContain(
      'src="https://cdn.discordapp.com/avatars/12345678901234567/hash.webp"',
    );
    expect(markup).not.toContain(">R</span>");
  });

  it("keeps initials as a fallback when no linked avatar is available", () => {
    const markup = renderToStaticMarkup(
      <UserMenu
        user={{
          id: "user-1",
          email: "reader@example.com",
          status: "active",
          discordUsername: "reader",
          displayName: "Reader Name",
          avatarUrl: null,
          discordLinked: true,
        }}
      />,
    );

    expect(markup).toContain(">RE</span>");
  });
});
