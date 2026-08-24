"use client";

import type { AuthenticatedUserView } from "../../lib/api/types";
import { useRouter } from "next/navigation";
import { useLogout } from "../../lib/domains/auth/hooks";

export function Topbar({ user }: { user: AuthenticatedUserView | null }) {
  const router = useRouter();
  const logout = useLogout();
  function openMobileNavigation() {
    window.dispatchEvent(new Event("nodeprox:open-mobile-nav"));
  }

  return (
    <header className="flex min-h-[76px] items-center justify-between border-b border-border bg-surface px-page py-4 max-[640px]:px-page-mobile max-[640px]:py-3">
      <div className="flex items-center">
        <button
          className="mr-2 hidden min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-[640px]:inline-flex"
          type="button"
          onClick={openMobileNavigation}
          aria-label="Abrir navegación"
        >
          ☰
        </button>
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
          Workspace
        </span>
        <h1 className="m-0 mt-0.5 text-lg font-semibold">NodeProx dashboard</h1>
      </div>
      <div className="flex items-center gap-2.5 text-sm text-muted">
        <span
          className="grid h-8 w-8 place-items-center rounded-full bg-primary-soft font-bold text-primary"
          aria-hidden="true"
        >
          {user?.email.slice(0, 1).toUpperCase() ?? "?"}
        </span>
        <span className="max-[640px]:hidden">
          {user?.email ?? "Sesión no disponible"}
        </span>
        <button
          className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3 font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
          type="button"
          disabled={logout.isPending}
          onClick={async () => {
            await logout.mutateAsync();
            router.replace("/login");
          }}
        >
          {logout.isPending ? "Saliendo…" : "Salir"}
        </button>
      </div>
    </header>
  );
}
