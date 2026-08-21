export type IconReference = string;

export interface NavigationItem {
  id: string;
  label: string;
  href?: string;
  icon: IconReference;
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
