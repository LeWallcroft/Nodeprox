export type DiscordVisualStatus =
  | "verified"
  | "unlinked"
  | "authorized"
  | "unauthorized"
  | "available"
  | "pending"
  | "cancelled"
  | "active"
  | "disabled";

const labels: Record<DiscordVisualStatus, string> = {
  verified: "✅ Verificado",
  unlinked: "⚠️ No vinculado",
  authorized: "🛡️ Autorizado",
  unauthorized: "⛔ No autorizado",
  available: "🟢 Disponible",
  pending: "🟡 Pendiente",
  cancelled: "⚪ Cancelado",
  active: "🟢 Activo",
  disabled: "🔴 Deshabilitado",
};

export function visualStatus(status: DiscordVisualStatus) {
  return labels[status];
}
