import { describe, expect, it } from "vitest";
import {
  trustedDiscordAvatarUrl,
  userInitials,
  userPrimaryLabel,
  userSecondaryLabel,
} from "./presentation.js";
import type { UserReference } from "@nodeprox/types";

const base: UserReference = {
  id: "user-1",
  email: "reader@example.com",
  displayName: "Reader Name",
  discordUsername: "reader_tag",
  avatarUrl: "https://cdn.discordapp.com/avatars/12345678901234567/hash.webp",
  discordLinked: true,
};

describe("Discord-first user presentation", () => {
  it("uses verified Discord identity first and preserves email as secondary", () => {
    expect(userPrimaryLabel(base)).toBe("@reader_tag");
    expect(userSecondaryLabel(base)).toBe("reader@example.com");
  });

  it("does not treat a manually entered username as verified", () => {
    const unlinked = { ...base, discordLinked: false };
    expect(userPrimaryLabel(unlinked)).toBe("Reader Name");
    expect(userInitials(unlinked)).toBe("RN");
    expect(trustedDiscordAvatarUrl(unlinked)).toBeNull();
    expect(userPrimaryLabel({ ...unlinked, displayName: null })).toBe(
      "reader@example.com",
    );
  });

  it("uses display name when a linked profile has no username and trusts only Discord CDN paths", () => {
    expect(userPrimaryLabel({ ...base, discordUsername: null })).toBe(
      "Reader Name",
    );
    expect(trustedDiscordAvatarUrl(base)).toBe(base.avatarUrl);
    expect(
      trustedDiscordAvatarUrl({
        ...base,
        avatarUrl: "https://evil.example/avatar.webp",
      }),
    ).toBeNull();
  });
});
