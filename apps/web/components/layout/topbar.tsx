"use client";

import type { ReactNode } from "react";
import type { AuthenticatedUserView } from "../../lib/api/types";
import { UserMenu } from "./user-menu";

export function Topbar({
  user,
  context = "Workspace",
  actions,
}: {
  user: AuthenticatedUserView | null;
  context?: string;
  actions?: ReactNode;
}) {
  function openMobileNavigation() {
    window.dispatchEvent(new Event("nodeprox:open-mobile-nav"));
  }

  return (
    <header className="z-10 flex shrink-0 min-h-[72px] items-center justify-between border-b border-border bg-background/95 px-page py-4 backdrop-blur max-[767px]:px-page-mobile max-[767px]:py-3">
      <div className="flex items-center gap-2">
        <button
          className="mr-2 hidden min-h-control items-center justify-center rounded-control border border-border bg-surface-elevated px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-[767px]:inline-flex"
          type="button"
          onClick={openMobileNavigation}
          aria-label="Abrir navegación"
        >
          ☰
        </button>
        <span className="text-[11px] font-medium uppercase tracking-[0.1em] text-muted">
          {context}
        </span>
      </div>
      <div className="flex items-center gap-3">
        {actions}
        <UserMenu user={user} />
      </div>
    </header>
  );
}
