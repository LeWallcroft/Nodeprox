import { navigationConfig, navigationSections } from "./config";
import type { NavigationItem } from "./types";

export interface NavigationSection {
  id: string;
  label: string;
  items: NavigationItem[];
}

export function getVisibleNavigation(
  capabilities: readonly string[],
): NavigationSection[] {
  const capabilitySet = new Set(capabilities);
  const itemsById = new Map(navigationConfig.map((item) => [item.id, item]));

  return navigationSections
    .map((section) => ({
      id: section.id,
      label: section.label,
      items: section.itemIds.reduce<NavigationItem[]>((items, id) => {
        const item = itemsById.get(id);
        if (
          item &&
          (!item.capabilityKey || capabilitySet.has(item.capabilityKey))
        )
          items.push(item);
        return items;
      }, []),
    }))
    .filter((section) => section.items.length > 0);
}
