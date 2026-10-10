"use client";

import { useState } from "react";
import type { UserReference } from "@nodeprox/types";
import {
  trustedDiscordAvatarUrl,
  userInitials,
} from "../../../lib/domains/users/presentation";

const sizes = {
  sm: "size-8 text-xs",
  md: "size-10 text-sm",
  lg: "size-16 text-xl",
};

export function UserAvatar({
  user,
  size = "md",
  className = "",
}: {
  user: UserReference;
  size?: keyof typeof sizes;
  className?: string;
}) {
  const trustedAvatar = trustedDiscordAvatarUrl(user);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (trustedAvatar && failedUrl !== trustedAvatar)
    return (
      // Discord CDN URLs are rendered directly; Image optimization would require a remote host policy.
      // biome-ignore lint/performance/noImgElement: Discord supplies per-user avatar URLs dynamically.
      <img
        alt=""
        aria-hidden="true"
        className={`shrink-0 rounded-full object-cover ${sizes[size]} ${className}`}
        decoding="async"
        loading="lazy"
        referrerPolicy="no-referrer"
        src={trustedAvatar}
        onError={() => setFailedUrl(trustedAvatar)}
      />
    );

  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full bg-primary-soft font-semibold text-primary ${sizes[size]} ${className}`}
    >
      {userInitials(user)}
    </span>
  );
}
