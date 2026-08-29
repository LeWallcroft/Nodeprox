"use client";

import { useRouter } from "next/navigation";
import type { AuthenticatedUserView } from "../../lib/api/types";
import { useLogout } from "../../lib/domains/auth/hooks";

export function UserMenu({ user }: { user: AuthenticatedUserView | null }) {
  const router = useRouter();
  const logout = useLogout();
  const initial = user?.email.slice(0, 1).toUpperCase() ?? "?";

  return (
    <div className="flex items-center gap-2.5 text-sm text-muted">
      <span
        className="grid h-9 w-9 place-items-center rounded-full bg-primary-soft font-bold text-primary"
        aria-hidden="true"
      >
        {initial}
      </span>
      <div className="hidden min-w-0 max-w-48 md:block">
        <p className="m-0 truncate text-sm font-semibold text-text">
          {user?.email ?? "Sesión no disponible"}
        </p>
        <p className="m-0 text-xs text-muted">Cuenta activa</p>
      </div>
      <button
        className="inline-flex min-h-control items-center justify-center rounded-control border border-border bg-surface-elevated px-3 font-semibold text-text transition-colors hover:bg-sidebar-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:opacity-60"
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
  );
}
