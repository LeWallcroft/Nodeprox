export type DiscordSemanticTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

const colors: Record<DiscordSemanticTone, number> = {
  neutral: 0x64748b,
  info: 0x8b5cf6,
  success: 0x16a34a,
  warning: 0xd97706,
  danger: 0xdc2626,
};

export function getDiscordEmbedColor(tone: DiscordSemanticTone): number {
  return colors[tone];
}
