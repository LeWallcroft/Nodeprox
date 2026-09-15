"use client";

import { Bell } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  formatUnreadCount,
  resolveNotificationAction,
} from "../../../lib/domains/notifications/actions";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useNotificationUnreadCount,
} from "../../../lib/domains/notifications/hooks";
import type { NotificationListItem } from "../../../lib/domains/notifications/types";
import { NotificationPanel } from "./notification-panel";

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const unread = useNotificationUnreadCount();
  const notifications = useNotifications(open);
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();
  const unreadCount = unread.data?.count ?? 0;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || !open) return;
      setOpen(false);
      trigger.current?.focus();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  async function selectNotification(notification: NotificationListItem) {
    if (!notification.readAt) await markRead.mutateAsync(notification.id);
    const destination = resolveNotificationAction(notification.actionKey);
    if (destination) router.push(destination);
    setOpen(false);
  }

  return (
    <div className="relative">
      <button
        ref={trigger}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unreadCount > 0
            ? `Notificaciones: ${unreadCount} sin leer`
            : "Notificaciones"
        }
        className="relative inline-flex size-9 items-center justify-center rounded-control border border-border bg-surface-elevated text-text transition-colors hover:bg-sidebar-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        type="button"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell aria-hidden="true" className="size-4" />
        {unreadCount > 0 ? (
          <span
            aria-hidden="true"
            className="absolute -right-2 -top-2 grid min-w-5 place-items-center rounded-full bg-primary px-1 text-[10px] font-bold leading-5 text-primary-foreground"
          >
            {formatUnreadCount(unreadCount)}
          </span>
        ) : null}
      </button>
      {open ? (
        <NotificationPanel
          notifications={notifications.data?.items ?? []}
          isLoading={notifications.isLoading}
          isError={notifications.isError}
          isMarkingAllRead={markAllRead.isPending}
          onNotificationClick={(notification) =>
            void selectNotification(notification)
          }
          onMarkAllRead={() => void markAllRead.mutateAsync()}
        />
      ) : null}
    </div>
  );
}
