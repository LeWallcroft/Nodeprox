"use client";

import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export interface TableRowAction {
  label: string;
  icon: ReactNode;
  onSelect: () => void;
  destructive?: boolean;
}

export function TableRowActionMenu({
  actions,
  label = "Más acciones",
}: {
  actions: readonly TableRowAction[];
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function closeOnOutsidePointer(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", closeOnOutsidePointer);
    return () =>
      document.removeEventListener("mousedown", closeOnOutsidePointer);
  }, []);

  if (!actions.length) return null;

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        aria-controls={menuId}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={label}
        className="inline-flex h-8 w-8 items-center justify-center rounded-control border border-border bg-surface text-text-secondary transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen((current) => !current);
        }}
      >
        <MoreHorizontal aria-hidden="true" className="size-4" />
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          className="absolute right-0 z-20 mt-9 grid min-w-48 gap-1 rounded-control border border-border bg-surface-elevated p-1 shadow-panel"
        >
          {actions.map((action) => (
            <button
              className={`flex min-h-9 items-center gap-2 rounded-control px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${action.destructive ? "text-destructive-text hover:text-destructive-text-hover" : "text-text-secondary hover:text-text"}`}
              key={action.label}
              role="menuitem"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setOpen(false);
                action.onSelect();
              }}
            >
              {action.icon}
              {action.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
