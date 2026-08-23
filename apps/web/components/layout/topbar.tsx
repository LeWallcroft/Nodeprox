"use client";

import type { AuthenticatedUserView } from "../../lib/api/types";

export function Topbar({ user }: { user: AuthenticatedUserView | null }) {
  function openMobileNavigation() {
    window.dispatchEvent(new Event("nodeprox:open-mobile-nav"));
  }

  return (
    <header className="topbar">
      <div>
        <button
          className="mobile-menu-button button button-secondary"
          type="button"
          onClick={openMobileNavigation}
          aria-label="Abrir navegación"
        >
          ☰
        </button>
        <span className="eyebrow">Workspace</span>
        <h1>NodeProx dashboard</h1>
      </div>
      <div className="topbar-user">
        <span className="avatar" aria-hidden="true">
          {user?.email.slice(0, 1).toUpperCase() ?? "?"}
        </span>
        <span className="user-email">
          {user?.email ?? "Sesión no disponible"}
        </span>
      </div>
    </header>
  );
}
