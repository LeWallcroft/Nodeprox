import { apiRequestBrowser } from "../../api/browser";
import type { NotificationPage, NotificationUnreadCount } from "./types";

export function getMyNotifications(limit = 8) {
  return apiRequestBrowser<NotificationPage>(
    `/me/notifications?limit=${encodeURIComponent(String(limit))}`,
  );
}

export function getMyNotificationUnreadCount() {
  return apiRequestBrowser<NotificationUnreadCount>(
    "/me/notifications/unread-count",
  );
}

export function markMyNotificationRead(notificationId: string) {
  return apiRequestBrowser<{ read: true }>(
    `/me/notifications/${encodeURIComponent(notificationId)}/read`,
    { method: "PATCH" },
  );
}

export function markAllMyNotificationsRead() {
  return apiRequestBrowser<{ count: number }>("/me/notifications/read-all", {
    method: "POST",
  });
}
