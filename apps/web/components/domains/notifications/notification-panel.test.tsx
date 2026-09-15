import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotificationPanel } from "./notification-panel";

const notification = {
  id: "notification-1",
  type: "series.creation_grant.issued",
  title: "Nueva autorización disponible",
  message: "Tienes una nueva autorización disponible para crear una Serie.",
  entityType: "series_creation_grant",
  entityId: "grant-1",
  actionKey: "authorizations",
  readAt: null,
  createdAt: "2026-09-15T12:00:00.000Z",
};

describe("NotificationPanel", () => {
  it("renders recent unread notifications and the bulk read action", () => {
    const markup = renderToStaticMarkup(
      <NotificationPanel
        notifications={[notification]}
        isLoading={false}
        isError={false}
        isMarkingAllRead={false}
        onNotificationClick={() => undefined}
        onMarkAllRead={() => undefined}
      />,
    );
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain("Marcar todas como leídas");
    expect(markup).toContain("Nueva autorización disponible");
    expect(markup).toContain("Sin leer");
  });

  it("renders compact loading, empty, and error states", () => {
    const loading = renderToStaticMarkup(
      <NotificationPanel
        notifications={[]}
        isLoading
        isError={false}
        isMarkingAllRead={false}
        onNotificationClick={() => undefined}
        onMarkAllRead={() => undefined}
      />,
    );
    const empty = renderToStaticMarkup(
      <NotificationPanel
        notifications={[]}
        isLoading={false}
        isError={false}
        isMarkingAllRead={false}
        onNotificationClick={() => undefined}
        onMarkAllRead={() => undefined}
      />,
    );
    const failed = renderToStaticMarkup(
      <NotificationPanel
        notifications={[]}
        isLoading={false}
        isError
        isMarkingAllRead={false}
        onNotificationClick={() => undefined}
        onMarkAllRead={() => undefined}
      />,
    );
    expect(loading).toContain("Cargando notificaciones");
    expect(empty).toContain("No tienes notificaciones nuevas.");
    expect(failed).toContain("No se pudieron cargar las notificaciones.");
  });
});
