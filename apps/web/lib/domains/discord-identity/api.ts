import { apiRequestBrowser } from "../../api/browser";
import type { DiscordLinkCodeResponse } from "./types";

export function generateDiscordLinkCode(): Promise<DiscordLinkCodeResponse> {
  return apiRequestBrowser<DiscordLinkCodeResponse>("/me/discord/link-code", {
    method: "POST",
  });
}
