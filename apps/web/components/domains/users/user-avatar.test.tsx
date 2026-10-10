import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UserAvatar } from "./user-avatar.js";

const linked = {
  id: "u1",
  email: "reader@example.com",
  displayName: "Reader Name",
  discordUsername: "reader",
  avatarUrl: "https://cdn.discordapp.com/avatars/12345678901234567/hash.webp",
  discordLinked: true,
};

describe("UserAvatar", () => {
  it("renders a trusted linked Discord avatar with safe loading attributes", () => {
    const markup = renderToStaticMarkup(<UserAvatar user={linked} />);
    expect(markup).toContain("<img");
    expect(markup).toContain('loading="lazy"');
    expect(markup).toContain('decoding="async"');
    expect(markup).toContain('referrerPolicy="no-referrer"');
  });

  it("uses initials when unlinked or when no trusted avatar is available", () => {
    expect(
      renderToStaticMarkup(
        <UserAvatar user={{ ...linked, discordLinked: false }} />,
      ),
    ).toContain(">RN</span>");
    expect(
      renderToStaticMarkup(
        <UserAvatar user={{ ...linked, avatarUrl: null }} />,
      ),
    ).toContain(">RE</span>");
  });
});
