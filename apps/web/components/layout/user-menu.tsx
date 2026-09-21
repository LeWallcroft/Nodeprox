"use client";

import { ChevronDown, LogOut, PlugZap, UserRound } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useRef, useState } from "react";
import type { AuthenticatedUserView } from "../../lib/api/types";
import { useCapabilities, useLogout } from "../../lib/domains/auth/hooks";
import { Button } from "../ui/button";

export function UserMenu({ user }: { user: AuthenticatedUserView | null }) {
  const router = useRouter();
  const logout = useLogout();
  const capabilities = useCapabilities();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Composite disclosure delegates Escape and focus-exit events from its focusable controls.
    <div
      className="relative text-sm"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Menú de cuenta"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        className="flex items-center gap-3 rounded-control border border-transparent p-1.5 text-text hover:bg-surface-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
      >
        <span
          aria-hidden="true"
          className="grid size-9 place-items-center rounded-full border border-border bg-surface-elevated font-semibold"
        >
          {user?.email.slice(0, 1).toUpperCase() ?? "?"}
        </span>
        <span className="hidden max-w-48 text-left sm:grid">
          <span className="truncate font-medium">
            {user?.email ?? "Cuenta"}
          </span>
          <span className="text-xs capitalize text-muted">
            {capabilities.data?.role ?? "Cuenta activa"}
          </span>
        </span>
        <ChevronDown aria-hidden="true" className="size-4 text-muted" />
      </button>
      {open ? (
        <div
          id={menuId}
          className="absolute right-0 top-full z-40 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-panel border border-border bg-surface-elevated p-2 shadow-panel"
        >
          <p className="m-0 truncate border-b border-border px-3 py-3 text-xs text-muted">
            {user?.email}
          </p>
          <Link
            href="/account"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-control px-3 py-3 text-text hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <UserRound aria-hidden="true" className="size-4" />
            Mi perfil
          </Link>
          <Link
            href="/account/integrations"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-control px-3 py-3 text-text hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          >
            <PlugZap aria-hidden="true" className="size-4" />
            Integraciones
          </Link>
          <div className="mt-1 border-t border-border pt-2">
            <Button
              className="w-full justify-start"
              variant="destructive"
              loading={logout.isPending}
              icon={<LogOut aria-hidden="true" className="size-4" />}
              type="button"
              onClick={async () => {
                setError(false);
                try {
                  await logout.mutateAsync();
                  router.replace("/login");
                } catch {
                  setError(true);
                }
              }}
            >
              Cerrar sesión
            </Button>
          </div>
          {error ? (
            <p role="alert" className="px-3 text-xs text-danger">
              No se pudo cerrar la sesión. Inténtalo de nuevo.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
