"use client";

import {
  BellRing,
  Database,
  Settings2,
  UploadCloud,
  Wrench,
} from "lucide-react";

export type SettingsSectionId =
  | "collaboration"
  | "uploads"
  | "storage"
  | "integrations"
  | "maintenance";

const items = [
  {
    id: "collaboration",
    label: "General / Colaboración",
    description: "Sistema y permisos",
    Icon: Settings2,
  },
  {
    id: "uploads",
    label: "Cargas",
    description: "Límites y comportamiento",
    Icon: UploadCloud,
  },
  {
    id: "storage",
    label: "Almacenamiento",
    description: "Backblaze B2 y Cloudflare",
    Icon: Database,
  },
  {
    id: "integrations",
    label: "Integraciones",
    description: "Discord y notificaciones",
    Icon: BellRing,
  },
  {
    id: "maintenance",
    label: "Mantenimiento",
    description: "Herramientas y diagnóstico",
    Icon: Wrench,
  },
] satisfies Array<{
  id: SettingsSectionId;
  label: string;
  description: string;
  Icon: typeof Settings2;
}>;

export function SettingsLocalNav({
  selected,
  onSelect,
}: {
  selected: SettingsSectionId;
  onSelect: (section: SettingsSectionId) => void;
}) {
  return (
    <nav
      aria-label="Secciones de configuración"
      className="rounded-panel border border-border bg-surface p-3 shadow-card xl:sticky xl:top-4"
    >
      <p className="mb-2 mt-1 px-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">
        Configuración
      </p>
      <div className="flex gap-2 overflow-x-auto xl:flex-col xl:overflow-visible">
        {items.map(({ id, label, description, Icon }) => (
          <button
            key={id}
            type="button"
            aria-current={selected === id ? "page" : undefined}
            className={`flex min-w-0 shrink-0 items-center gap-3 rounded-control border px-3 py-2.5 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary max-xl:min-w-44 max-xl:flex-1 ${selected === id ? "border-primary bg-primary-soft font-medium text-primary" : "border-transparent bg-transparent text-text-secondary hover:border-border hover:bg-surface-hover"}`}
            onClick={() => onSelect(id)}
          >
            <Icon aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0">
              <span className="block text-sm">{label}</span>
              <span className="hidden text-xs text-muted xl:block">
                {description}
              </span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
