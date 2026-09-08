"use client";

import { useMutation } from "@tanstack/react-query";
import { generateDiscordLinkCode } from "./api";

export function useGenerateDiscordLinkCode() {
  return useMutation({ mutationFn: generateDiscordLinkCode });
}
