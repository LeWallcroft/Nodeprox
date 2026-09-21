"use client";

import { Check, Search } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Button } from "./button";
import { ContentImage } from "./content-image";
import { FieldShell } from "./field-shell";

export interface ComboboxOption {
  id: string;
  label: string;
  imageUrl?: string | null;
  description?: string | null;
}

export function SearchableCombobox({
  id,
  label,
  value,
  options,
  onChange,
  onSearchChange,
  loading = false,
  error,
  onRetry,
  disabled = false,
  required = false,
  labelHidden = false,
  placeholder = "Buscar y seleccionar…",
  emptyMessage = "No hay opciones disponibles.",
}: {
  id: string;
  label: string;
  value: string;
  options: readonly ComboboxOption[];
  onChange: (id: string) => void;
  onSearchChange?: ((value: string) => void) | undefined;
  loading?: boolean;
  error?: string | undefined;
  onRetry?: (() => void) | undefined;
  disabled?: boolean;
  required?: boolean;
  labelHidden?: boolean;
  placeholder?: string;
  emptyMessage?: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [overlayRect, setOverlayRect] = useState<DOMRect | null>(null);
  const positionOverlay = useCallback(() => {
    setOverlayRect(inputRef.current?.getBoundingClientRect() ?? null);
  }, []);
  useEffect(() => {
    if (!open) return;
    positionOverlay();
    window.addEventListener("resize", positionOverlay);
    window.addEventListener("scroll", positionOverlay, true);
    return () => {
      window.removeEventListener("resize", positionOverlay);
      window.removeEventListener("scroll", positionOverlay, true);
    };
  }, [open, positionOverlay]);
  useEffect(() => {
    if (open)
      listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  const filtered = options.filter((option) =>
    option.label.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const selected = options.find((option) => option.id === value);
  function choose(option: ComboboxOption) {
    onChange(option.id);
    setOpen(false);
    setQuery("");
    onSearchChange?.("");
  }
  return (
    <FieldShell
      id={id}
      label={label}
      required={required}
      labelHidden={labelHidden}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Delegates focus-exit handling for the combobox input and its retry control. */}
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false);
            setQuery("");
          }
        }}
      >
        <div className="relative">
          <input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={listId}
            aria-required={required}
            aria-invalid={Boolean(error)}
            aria-busy={loading}
            aria-activedescendant={
              open && filtered[active] ? `${listId}-${active}` : undefined
            }
            className="pr-10"
            autoComplete="off"
            disabled={disabled || loading || Boolean(error)}
            placeholder={loading ? "Cargando…" : placeholder}
            value={open ? query : (selected?.label ?? "")}
            onFocus={() => {
              setOpen(true);
              positionOverlay();
              setActive(0);
              onSearchChange?.(query);
            }}
            onClick={() => {
              setOpen(true);
              positionOverlay();
            }}
            onChange={(event) => {
              const nextQuery = event.target.value;
              setQuery(nextQuery);
              onSearchChange?.(nextQuery);
              setOpen(true);
              setActive(0);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                setQuery("");
                onSearchChange?.("");
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setActive((current) =>
                  Math.max(
                    0,
                    Math.min(
                      filtered.length - 1,
                      open ? current + (event.key === "ArrowDown" ? 1 : -1) : 0,
                    ),
                  ),
                );
              }
              if (event.key === "Enter" && open) {
                event.preventDefault();
                const option = filtered[active];
                if (option) choose(option);
              }
            }}
          />
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute right-3 top-3 size-4 text-muted"
          />
        </div>
        {open && !disabled && !loading && !error ? (
          <div
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label={label}
            className="fixed z-[70] m-0 max-h-48 list-none overflow-y-auto rounded-control border border-border bg-surface-elevated p-1 shadow-panel"
            style={
              overlayRect
                ? {
                    left: overlayRect.left,
                    top: overlayRect.bottom + 4,
                    width: overlayRect.width,
                  }
                : undefined
            }
          >
            {filtered.map((option, index) => (
              <div
                id={`${listId}-${index}`}
                key={option.id}
                role="option"
                tabIndex={-1}
                aria-selected={value === option.id}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded-control px-3 py-2 text-sm ${active === index ? "bg-primary-soft text-text" : "text-text-secondary hover:bg-surface-hover"}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(option)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") choose(option);
                }}
              >
                <span className="flex min-w-0 items-center gap-2">
                  {option.imageUrl ? (
                    <ContentImage
                      alt="Portada de la serie"
                      src={option.imageUrl}
                      variant="thumbnail"
                    />
                  ) : null}
                  <span className="min-w-0">
                    <span className="block truncate">{option.label}</span>
                    {option.description ? (
                      <span className="block truncate text-xs text-muted">
                        {option.description}
                      </span>
                    ) : null}
                  </span>
                </span>
                {value === option.id ? (
                  <Check aria-hidden="true" className="size-4 shrink-0" />
                ) : null}
              </div>
            ))}
            {!filtered.length ? (
              <div role="presentation" className="p-3 text-sm text-muted">
                {options.length
                  ? "Sin resultados para esta búsqueda."
                  : emptyMessage}
              </div>
            ) : null}
          </div>
        ) : null}
        {error ? (
          <div role="alert" className="mt-2 grid gap-2 text-sm text-danger">
            {error}
            {onRetry ? (
              <Button variant="secondary" type="button" onClick={onRetry}>
                Reintentar
              </Button>
            ) : null}
          </div>
        ) : null}
        {!loading && !error && !options.length && !open ? (
          <p className="mb-0 text-xs text-muted">{emptyMessage}</p>
        ) : null}
      </div>
    </FieldShell>
  );
}
