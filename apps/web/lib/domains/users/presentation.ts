import type { UserReference } from "@nodeprox/types";

export function userPrimaryLabel(user: UserReference): string {
  if (user.discordLinked && user.discordUsername)
    return `@${user.discordUsername}`;
  return user.displayName?.trim() || user.email;
}

export function userSecondaryLabel(user: UserReference): string | null {
  const primary = userPrimaryLabel(user);
  return user.email && user.email !== primary ? user.email : null;
}

export function userInitials(user: UserReference): string {
  const source =
    (user.discordLinked ? user.discordUsername : null) ||
    user.displayName?.trim() ||
    user.email;
  const parts = source
    .replace(/^@/, "")
    .split(/[\s._-]+/)
    .filter(Boolean);
  return (
    parts.length > 1
      ? `${parts[0]?.[0] ?? ""}${parts.at(-1)?.[0] ?? ""}`
      : (parts[0] ?? "?").slice(0, 2)
  ).toUpperCase();
}

export function trustedDiscordAvatarUrl(user: UserReference): string | null {
  if (!user.discordLinked || !user.avatarUrl) return null;
  try {
    const url = new URL(user.avatarUrl);
    const validPath =
      /^\/avatars\/\d{17,20}\/[A-Za-z0-9_]+\.(?:webp|png|gif|jpg)$/i.test(
        url.pathname,
      ) || /^\/embed\/avatars\/\d+\.png$/i.test(url.pathname);
    return url.protocol === "https:" &&
      url.hostname === "cdn.discordapp.com" &&
      validPath &&
      !url.username &&
      !url.password
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
