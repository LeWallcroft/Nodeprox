"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
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
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("nodeprox:open-mobile-nav", open);
    return () => window.removeEventListener("nodeprox:open-mobile-nav", open);
  }, []);

  return (
    <>
      {mobileOpen ? (
        <button
          className="sidebar-overlay"
          type="button"
          aria-label="Cerrar navegación"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <aside
        className={`sidebar${collapsed ? " sidebar-collapsed" : ""}${mobileOpen ? " sidebar-mobile-open" : ""}`}
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
    </>
  );
}
