import { apiRequestBrowser } from "../../api/browser";
import type { DiscordLinkCodeResponse, DiscordLinkStatus } from "./types";

export function getDiscordLinkStatus(): Promise<DiscordLinkStatus> {
  return apiRequestBrowser<DiscordLinkStatus>("/me/discord-link");
}

export function generateDiscordLinkCode(): Promise<DiscordLinkCodeResponse> {
  return apiRequestBrowser<DiscordLinkCodeResponse>("/me/discord/link-code", {
    method: "POST",
  });
}
