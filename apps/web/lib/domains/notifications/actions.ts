const notificationActions: Record<string, string> = {
  authorizations: "/autorizaciones",
};

export function resolveNotificationAction(
  actionKey: string | null,
): string | null {
  if (!actionKey) return null;
  return notificationActions[actionKey] ?? null;
}

export function formatUnreadCount(count: number): string {
  return count > 99 ? "99+" : String(count);
}
