import type { NavigationItem } from "./types";

export const navigationConfig: NavigationItem[] = [
  { id: "overview", label: "Overview", href: "/", icon: "⌂" },
  { id: "series", label: "Series", href: "/series", icon: "▦" },
  { id: "uploads", label: "Cargas", href: "/cargas", icon: "⇧" },
  { id: "links", label: "Enlaces", href: "/enlaces", icon: "↗" },
  {
    id: "admin",
    label: "Administración",
    icon: "⚙",
    capabilityKey: "admin.view",
    children: [
      {
        id: "admin-settings",
        label: "Configuración",
        href: "/admin",
        icon: "•",
      },
    ],
  },
];
