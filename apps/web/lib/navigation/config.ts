import {
  FileText,
  LayoutDashboard,
  Layers3,
  Settings,
  Users,
  ScrollText,
} from "lucide-react";
import type { NavigationItem } from "./types";

export const navigationConfig: NavigationItem[] = [
  { id: "overview", label: "Overview", href: "/", icon: LayoutDashboard },
  {
    id: "audit",
    label: "Auditoría",
    href: "/admin/audit",
    icon: ScrollText,
    capabilityKey: "admin.system.manage",
  },
  {
    id: "series",
    label: "Series",
    href: "/series",
    icon: Layers3,
    capabilityKey: "series.read",
  },
  {
    id: "chapters",
    label: "Capítulos",
    href: "/chapters",
    icon: FileText,
    capabilityKey: "chapters.read",
  },
  {
    id: "settings",
    label: "Configuración",
    href: "/admin/settings",
    icon: Settings,
    capabilityKey: "admin.system.manage",
  },
  {
    id: "users",
    label: "Usuarios",
    href: "/admin/users",
    icon: Users,
    capabilityKey: "admin.users.manage",
  },
];

export const navigationSections = [
  { id: "principal", label: "Principal", itemIds: ["overview"] },
  {
    id: "content",
    label: "Contenido",
    itemIds: ["series", "chapters"],
  },
  {
    id: "administration",
    label: "Administración",
    itemIds: ["users", "audit", "settings"],
  },
] as const;
