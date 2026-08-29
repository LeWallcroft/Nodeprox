import type { LucideIcon } from "lucide-react";

export interface NavigationItem {
  id: string;
  label: string;
  href?: string;
  icon: LucideIcon;
  children?: NavigationItem[];
  capabilityKey?: string;
}

export interface BreadcrumbItem {
  label: string;
  href?: string;
  current?: boolean;
}

export type CapabilityKey = string;
export type CapabilitySet = ReadonlySet<CapabilityKey>;
