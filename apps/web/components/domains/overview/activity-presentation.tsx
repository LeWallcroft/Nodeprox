import type { LucideIcon } from "lucide-react";
import {
  Activity,
  FileText,
  Images,
  Layers3,
  Settings,
  ShieldCheck,
  Upload,
  UserPlus,
  UserRoundMinus,
  UserRoundPlus,
  Users,
} from "lucide-react";

export function getActivityPresentation(
  action: string,
  resourceType: string,
): { label: string; icon: LucideIcon } {
  const known: Record<string, { label: string; icon: LucideIcon }> = {
    "settings.updated": { label: "Configuración actualizada", icon: Settings },
    "chapter.permission.granted": {
      label: "Colaborador asignado",
      icon: UserRoundPlus,
    },
    "chapter.permission.revoked": {
      label: "Colaborador revocado",
      icon: UserRoundMinus,
    },
    "chapter.upload.initiated": { label: "Carga iniciada", icon: Upload },
    "chapter.upload.completed": { label: "Carga completada", icon: Images },
    "chapter.upload.failed": { label: "Carga fallida", icon: Upload },
    "chapter.upload.aborted": { label: "Carga cancelada", icon: Upload },
    admin_bootstrap_created: { label: "Usuario administrador creado", icon: UserPlus },
    admin_bootstrap_promoted: { label: "Usuario administrador actualizado", icon: Users },
  };
  if (known[action]) return known[action];
  if (resourceType === "series") return { label: "Actividad de serie", icon: Layers3 };
  if (resourceType === "chapter") return { label: "Actividad de capítulo", icon: FileText };
  if (resourceType === "image") return { label: "Actividad de imágenes", icon: Images };
  if (resourceType === "user") return { label: "Actividad de usuario", icon: Users };
  if (resourceType === "role" || resourceType === "permission")
    return { label: "Actividad de permisos", icon: ShieldCheck };
  return { label: "Actividad registrada", icon: Activity };
}

export function formatActivityDate(value: string): string {
  const date = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const time = new Intl.DateTimeFormat("es-PE", {
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
  const difference = Math.round((today.getTime() - day.getTime()) / 86_400_000);
  if (difference === 0) return `Hoy, ${time}`;
  if (difference === 1) return `Ayer, ${time}`;
  return new Intl.DateTimeFormat("es-PE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value >= 10 || exponent === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[exponent]}`;
}
