import { createLinkSuccessEmbed } from "../embeds/link.embed.js";

export function presentLinkSuccess() {
  return { embeds: [createLinkSuccessEmbed()] };
}
