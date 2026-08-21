"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { navigationConfig } from "../../lib/navigation/config";
import { isNavigationItemActive } from "../../lib/routing/is-active";
import type { NavigationItem } from "../../lib/navigation/types";

function NavigationLink({
  item,
  collapsed,
}: {
  item: NavigationItem;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const active = isNavigationItemActive(pathname, item.href);
  return item.href ? (
    <Link
      className={`nav-link${active ? " nav-link-active" : ""}`}
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
    >
      <span className="nav-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="nav-label">{item.label}</span>
    </Link>
  ) : (
    <span className="nav-section-label">
      <span className="nav-icon" aria-hidden="true">
        {item.icon}
      </span>
      <span className="nav-label">{item.label}</span>
    </span>
  );
}

export function Sidebar() {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <aside
      className={`sidebar${collapsed ? " sidebar-collapsed" : ""}`}
      aria-label="Navegación principal"
    >
      <div className="sidebar-brand">
        <span className="brand-mark">N</span>
        <span className="nav-label">NodeProx</span>
      </div>
      <nav className="sidebar-nav">
        {navigationConfig.map((item) => (
          <div key={item.id}>
            <NavigationLink item={item} collapsed={collapsed} />
            {item.children?.map((child) => (
              <NavigationLink
                key={child.id}
                item={child}
                collapsed={collapsed}
              />
            ))}
          </div>
        ))}
      </nav>
      <button
        className="sidebar-toggle"
        type="button"
        onClick={() => setCollapsed((value) => !value)}
        aria-label={collapsed ? "Expandir navegación" : "Colapsar navegación"}
        aria-pressed={collapsed}
      >
        {collapsed ? "→" : "←"}
      </button>
    </aside>
  );
}
