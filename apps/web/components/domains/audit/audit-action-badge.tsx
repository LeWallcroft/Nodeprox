import {
  CircleDot,
  type LucideIcon,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Upload,
} from "lucide-react";
import type { ReactNode } from "react";
import { StatusBadge } from "../../ui/status-badge";

type AuditActionPresentation = {
  label: string;
  tone: "neutral" | "info" | "success" | "warning" | "danger";
  Icon: LucideIcon;
};

export function auditActionPresentation(
  action: string,
): AuditActionPresentation {
  const normalized = action.toLowerCase();

  if (normalized === "chapter.upload.initiated")
    return { label: "Carga iniciada", tone: "info", Icon: Upload };
  if (normalized === "chapter.upload.completed")
    return { label: "Carga completada", tone: "success", Icon: ShieldCheck };
  if (normalized === "chapter.upload.aborted")
    return { label: "Carga cancelada", tone: "warning", Icon: Upload };
  if (normalized === "chapter.upload.failed")
    return { label: "Carga fallida", tone: "danger", Icon: Upload };

  if (normalized.includes("delete") || normalized.includes("removed")) {
    return { label: "Eliminar", tone: "danger", Icon: Trash2 };
  }
  if (normalized.includes("upload")) {
    return { label: "Subir", tone: "info", Icon: Upload };
  }
  if (normalized.includes("processing")) {
    return { label: "Procesar", tone: "info", Icon: CircleDot };
  }
  if (normalized.includes("completed")) {
    return { label: "Completar", tone: "success", Icon: ShieldCheck };
  }
  if (
    normalized.includes("permission") ||
    normalized.includes("assign") ||
    normalized.includes("revoke") ||
    normalized.includes("authorize")
  ) {
    return { label: "Autorización", tone: "warning", Icon: ShieldCheck };
  }
  if (normalized.includes("create") || normalized.includes("registered")) {
    return { label: "Crear", tone: "success", Icon: Plus };
  }
  if (normalized.includes("update") || normalized.includes("changed")) {
    return { label: "Actualizar", tone: "info", Icon: Pencil };
  }

  return { label: action, tone: "neutral", Icon: CircleDot };
}

export function AuditActionBadge({ action }: { action: string }) {
  const { label, tone, Icon } = auditActionPresentation(action);
  const content: ReactNode = (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className="size-3.5" />
      {label}
    </span>
  );
  return <StatusBadge label={content} tone={tone} />;
}
