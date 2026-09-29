"use client";

import {
  ArrowUpRight,
  BellRing,
  Gauge,
  Search,
  UploadCloud,
  Wrench,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { ProductSettings } from "../../../lib/domains/settings/types";
import { Input } from "../../ui/input";
import { DiscordAuthorizationConfiguration } from "../discord/discord-authorization-configuration";
import { MaintenancePanel } from "./maintenance-panel";
import { ProductSettingsSection } from "./product-settings-section";
import { SettingsLocalNav, type SettingsSectionId } from "./settings-local-nav";
import { StorageProfilesPanel } from "./storage-profiles-panel";

export function SettingsWorkspace({
  settings,
  saving,
  saveError,
  onSave,
}: {
  settings: ProductSettings;
  saving: boolean;
  saveError?: string | undefined;
  onSave: (
    changes: Array<{ key: string; value: number | boolean | string }>,
  ) => Promise<ProductSettings>;
}) {
  const [selected, setSelected] = useState<SettingsSectionId>("collaboration");
  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [focusSetting, setFocusSetting] = useState<string | null>(null);
  const productSection = settings.sections.find((item) => item.id === selected);
  const searchResults = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    if (!query) return [];
    const sections = settings.sections.map((section) => ({
      id: section.id as SettingsSectionId,
      label: section.label,
      description: "Configuración de la sección.",
      fieldKey: null as string | null,
    }));
    const fields = settings.sections.flatMap((section) =>
      section.fields.map((field) => ({
        id: section.id as SettingsSectionId,
        label: field.label,
        description: `${section.label} · ${field.helpText}`,
        fieldKey: field.key,
      })),
    );
    const storage = {
      id: "storage" as const,
      label: "Almacenamiento B2",
      description: "Perfiles, preparación y activación.",
      fieldKey: null,
    };
    return [...sections, ...fields, storage]
      .filter((item) =>
        `${item.label} ${item.description}`.toLocaleLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [search, settings.sections]);

  useEffect(() => {
    if (!focusSetting || productSection?.id !== selected) return;
    document.getElementById(`setting-${focusSetting}`)?.focus();
    setFocusSetting(null);
  }, [focusSetting, productSection, selected]);

  useEffect(() => {
    function openSearch(event: KeyboardEvent) {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k")
        return;
      event.preventDefault();
      document
        .querySelector<HTMLInputElement>(
          'input[aria-label="Buscar en la configuración"]',
        )
        ?.focus();
      setSearchOpen(true);
    }
    document.addEventListener("keydown", openSearch);
    return () => document.removeEventListener("keydown", openSearch);
  }, []);

  return (
    <div className="grid min-w-0 gap-4 xl:grid-cols-[12rem_minmax(0,1fr)]">
      <aside className="xl:row-span-2">
        <SettingsLocalNav selected={selected} onSelect={setSelected} />
      </aside>
      <div className="min-w-0 space-y-4">
        <div className="relative ml-auto flex w-full max-w-sm items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-control border border-border bg-surface text-muted"
          >
            <Search className="size-4" />
          </span>
          <Input
            type="text"
            aria-label="Buscar en la configuración"
            placeholder="Buscar en la configuración…"
            value={search}
            className="min-h-11 min-w-0 flex-1 rounded-control border border-border bg-surface px-3 pr-16 text-sm text-text placeholder:text-muted focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            onFocus={() => setSearchOpen(true)}
            onBlur={(event) => {
              const nextFocus = event.relatedTarget;
              if (
                !(nextFocus instanceof Node) ||
                !event.currentTarget.parentElement?.contains(nextFocus)
              ) {
                setSearchOpen(false);
              }
            }}
            onChange={(event) => {
              setSearch(event.target.value);
              setSearchOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setSearch("");
                setSearchOpen(false);
              }
              if (event.key === "ArrowDown" && searchResults.length) {
                event.preventDefault();
                document.getElementById("settings-search-result-0")?.focus();
              }
              if (event.key === "Enter" && searchResults[0]) {
                event.preventDefault();
                setSelected(searchResults[0].id);
                setFocusSetting(searchResults[0].fieldKey);
                setSearch("");
                setSearchOpen(false);
              }
            }}
          />
          {!search ? (
            <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-border bg-surface-elevated px-1.5 py-0.5 text-[10px] text-muted">
              Ctrl K
            </kbd>
          ) : null}
          {searchOpen && search.trim() ? (
            <section
              id="settings-search-results"
              aria-label="Resultados de configuración"
              aria-live="polite"
              className="absolute inset-x-0 top-full z-20 mt-2 rounded-panel border border-border bg-surface-elevated p-1 shadow-panel"
            >
              {searchResults.length ? (
                searchResults.map((result) => (
                  <button
                    key={`${result.id}-${result.fieldKey ?? result.label}`}
                    type="button"
                    id={`settings-search-result-${searchResults.indexOf(result)}`}
                    className="flex w-full items-start gap-3 rounded-control px-3 py-2 text-left hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      setSelected(result.id);
                      setFocusSetting(result.fieldKey);
                      setSearch("");
                      setSearchOpen(false);
                    }}
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-text">
                        {result.label}
                      </span>
                      <span className="block text-xs text-muted">
                        {result.description}
                      </span>
                    </span>
                    <ArrowUpRight
                      aria-hidden="true"
                      className="ml-auto mt-1 size-4 shrink-0 text-muted"
                    />
                  </button>
                ))
              ) : (
                <p className="m-0 px-3 py-2 text-sm text-muted">
                  No hay coincidencias en Configuración.
                </p>
              )}
            </section>
          ) : null}
        </div>
        <section aria-label="Configuración seleccionada" className="min-w-0">
          {productSection ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
                  {selected === "uploads" ? (
                    <UploadCloud aria-hidden="true" className="size-5" />
                  ) : (
                    <Gauge aria-hidden="true" className="size-5" />
                  )}
                </span>
                <div>
                  <h2 className="m-0 text-xl font-semibold">
                    {productSection.label}
                  </h2>
                  <p className="mb-0 mt-1 text-sm text-muted">
                    Ajusta valores operativos con validación y cambios
                    explícitos.
                  </p>
                </div>
              </div>
              <ProductSettingsSection
                key={productSection.id}
                section={productSection}
                saving={saving}
                saveError={saveError}
                onSave={onSave}
              />
            </div>
          ) : null}
          {selected === "storage" ? <StorageProfilesPanel /> : null}
          {selected === "integrations" ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-control bg-primary-soft text-primary">
                  <BellRing aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h2 className="m-0 text-xl font-semibold">Integraciones</h2>
                  <p className="mb-0 mt-1 text-sm text-muted">
                    Conexiones de Discord y autorización.
                  </p>
                </div>
              </div>
              <DiscordAuthorizationConfiguration />
            </div>
          ) : null}
          {selected === "maintenance" ? (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <span className="grid size-10 place-items-center rounded-control bg-primary-soft text-primary">
                  <Wrench aria-hidden="true" className="size-5" />
                </span>
                <div>
                  <h2 className="m-0 text-xl font-semibold">Mantenimiento</h2>
                  <p className="mb-0 mt-1 text-sm text-muted">
                    Estado operativo y preparación para despliegues.
                  </p>
                </div>
              </div>
              <MaintenancePanel />
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}
