"use client";

import { X } from "lucide-react";
import { type ReactNode, useEffect, useId, useRef } from "react";

const focusable = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function AppDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = "md",
  busy = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  busy?: boolean;
}) {
  const panelRef = useRef<HTMLElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  const titleId = useId();
  const descriptionId = useId();
  onOpenChangeRef.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const timer = window.setTimeout(() => {
      panelRef.current?.querySelector<HTMLElement>(focusable)?.focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onOpenChangeRef.current(false);
        return;
      }
      if (event.key !== "Tab") return;
      const items = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(focusable) ?? [],
      );
      if (!items.length) return;
      const first = items[0];
      const last = items.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
      previousFocus.current?.focus();
    };
  }, [busy, open]);

  if (!open) return null;
  const width = {
    sm: "max-w-[480px]",
    md: "max-w-[620px]",
    lg: "max-w-[760px]",
  }[size];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center p-4 sm:p-6">
      <button
        aria-label="Cerrar diálogo"
        className="absolute inset-0 cursor-default border-0 bg-background/70 backdrop-blur-sm"
        disabled={busy}
        type="button"
        onClick={() => onOpenChange(false)}
      />
      <section
        aria-describedby={description ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`relative z-10 flex max-h-[calc(100dvh-2rem)] w-full ${width} flex-col overflow-hidden rounded-panel border border-[var(--border-subtle)] bg-surface-elevated shadow-panel sm:max-h-[calc(100dvh-3rem)]`}
        ref={panelRef}
        role="dialog"
      >
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--border-subtle)] px-5 py-4">
          <div>
            <h2 id={titleId} className="m-0 text-xl font-semibold">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mb-0 mt-1 text-sm text-muted">
                {description}
              </p>
            ) : null}
          </div>
          <button
            aria-label="Cerrar diálogo"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-control border border-[var(--border-subtle)] bg-surface text-secondary hover:bg-surface-hover hover:text-text"
            disabled={busy}
            type="button"
            onClick={() => onOpenChange(false)}
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        </header>
        <div className="min-h-0 overflow-x-hidden overflow-y-auto px-5 py-4">
          {children}
        </div>
        {footer ? (
          <footer className="shrink-0 border-t border-[var(--border-subtle)] px-5 py-4">
            {footer}
          </footer>
        ) : null}
      </section>
    </div>
  );
}
