"use client";

import { CheckCheck, LoaderCircle } from "lucide-react";
import type { NotificationListItem } from "../../../lib/domains/notifications/types";
import { Button } from "../../ui/button";
import { Skeleton } from "../../ui/skeleton";

export function NotificationPanel({
  notifications,
  isLoading,
  isError,
  isMarkingAllRead,
  onNotificationClick,
  onMarkAllRead,
}: {
  notifications: readonly NotificationListItem[];
  isLoading: boolean;
  isError: boolean;
  isMarkingAllRead: boolean;
  onNotificationClick: (notification: NotificationListItem) => void;
  onMarkAllRead: () => void;
}) {
  const hasUnread = notifications.some((notification) => !notification.readAt);
  return (
    <section
      aria-label="Notificaciones"
      className="absolute right-0 top-[calc(100%+0.75rem)] w-[min(25rem,calc(100vw-1.5rem))] rounded-panel border border-border bg-surface-elevated p-3 shadow-panel"
      role="dialog"
    >
      <header className="mb-2 flex items-center justify-between gap-3 px-1">
        <h2 className="m-0 text-base font-semibold text-text">
          Notificaciones
        </h2>
        {hasUnread ? (
          <Button
            className="min-h-8 px-2.5 text-xs"
            type="button"
            variant="secondary"
            disabled={isMarkingAllRead}
            onClick={onMarkAllRead}
          >
            {isMarkingAllRead ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-3.5 animate-spin"
              />
            ) : (
              <CheckCheck aria-hidden="true" className="size-3.5" />
            )}
            Marcar todas como leídas
          </Button>
        ) : null}
      </header>
      {isLoading ? <NotificationPanelLoading /> : null}
      {isError ? (
        <p
          className="m-0 rounded-control border border-danger/40 bg-danger-soft px-3 py-4 text-center text-sm text-text"
          role="alert"
        >
          No se pudieron cargar las notificaciones.
        </p>
      ) : null}
      {!isLoading && !isError && notifications.length === 0 ? (
        <p className="m-0 px-3 py-7 text-center text-sm text-secondary">
          No tienes notificaciones nuevas.
        </p>
      ) : null}
      {!isLoading && !isError && notifications.length > 0 ? (
        <div className="max-h-[min(60vh,34rem)] space-y-1 overflow-y-auto pr-1">
          {notifications.map((notification) => (
            <NotificationItem
              key={notification.id}
              notification={notification}
              onClick={() => onNotificationClick(notification)}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function NotificationPanelLoading() {
  return (
    <div
      className="space-y-2 p-1"
      role="status"
      aria-label="Cargando notificaciones"
    >
      <Skeleton label="Cargando notificaciones" />
      <Skeleton label="Cargando notificaciones" />
      <Skeleton label="Cargando notificaciones" />
    </div>
  );
}

function NotificationItem({
  notification,
  onClick,
}: {
  notification: NotificationListItem;
  onClick: () => void;
}) {
  const unread = !notification.readAt;
  return (
    <button
      className={`w-full rounded-control border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${
        unread
          ? "border-primary/30 bg-primary-soft/60 hover:bg-primary-soft"
          : "border-transparent bg-surface hover:bg-surface-hover"
      }`}
      type="button"
      onClick={onClick}
    >
      <span className="flex items-start gap-2">
        <span
          aria-hidden="true"
          className={`mt-1.5 size-2 shrink-0 rounded-full ${
            unread ? "bg-primary" : "bg-border"
          }`}
        />
        <span className="sr-only">{unread ? "Sin leer" : "Leída"}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-text">
            {notification.title}
          </span>
          <span className="mt-0.5 block text-sm text-secondary">
            {notification.message}
          </span>
          <span className="mt-1 block text-xs text-muted">
            {formatNotificationTime(notification.createdAt)}
          </span>
        </span>
      </span>
    </button>
  );
}

function formatNotificationTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(parsed);
}
