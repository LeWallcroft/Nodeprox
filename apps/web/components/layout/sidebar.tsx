"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { getVisibleNavigation } from "../../lib/navigation/policy";
import { isNavigationItemActive } from "../../lib/routing/is-active";
import type { NavigationItem } from "../../lib/navigation/types";
import { MobileDrawer } from "./mobile-drawer";

function NavigationLink({
  item,
  collapsed,
}: {
  item: NavigationItem;
  collapsed: boolean;
}) {
  const pathname = usePathname();
  const active = isNavigationItemActive(pathname, item.href);
  const Icon = item.icon;
  return item.href ? (
    <Link
      className={`relative flex min-h-control items-center gap-3 rounded-control px-2.5 text-sidebar-muted transition-colors hover:bg-surface-hover hover:text-sidebar-text focus-visible:bg-surface-hover focus-visible:text-sidebar-text focus-visible:outline-none ${active ? "bg-sidebar-active text-sidebar-text before:absolute before:inset-y-1.5 before:left-0 before:w-0.5 before:rounded-r before:bg-primary" : ""}`}
      href={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      title={collapsed ? item.label : undefined}
    >
      <span
        className="inline-grid w-5 shrink-0 place-items-center"
        aria-hidden="true"
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className={collapsed ? "hidden max-[640px]:inline" : ""}>
        {item.label}
      </span>
    </Link>
  ) : (
    <span className="mt-4 flex min-h-control items-center gap-3 px-2.5 text-xs uppercase text-sidebar-muted">
      <span
        className="inline-grid w-5 shrink-0 place-items-center"
        aria-hidden="true"
      >
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <span className={collapsed ? "hidden max-[640px]:inline" : ""}>
        {item.label}
      </span>
    </span>
  );
}

export function Sidebar({
  capabilities,
  initialCollapsed = false,
}: {
  capabilities: readonly string[];
  initialCollapsed?: boolean;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);
  const sections = getVisibleNavigation(capabilities);

  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("nodeprox:open-mobile-nav", open);
    return () => window.removeEventListener("nodeprox:open-mobile-nav", open);
  }, []);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1280px)");
    const resetDesktopSidebar = () => {
      if (media.matches) setCollapsed(false);
    };
    resetDesktopSidebar();
    media.addEventListener("change", resetDesktopSidebar);
    return () => media.removeEventListener("change", resetDesktopSidebar);
  }, []);

  return (
    <MobileDrawer open={mobileOpen} onClose={() => setMobileOpen(false)}>
      <aside
        className={`z-30 flex h-dvh w-sidebar shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-5 text-sidebar-text transition-[width,flex-basis,transform] duration-200 ease-in-out ${collapsed ? "w-sidebar-collapsed" : ""} ${mobileOpen ? "max-[767px]:translate-x-0" : ""} max-[767px]:fixed max-[767px]:-translate-x-full max-[767px]:shadow-panel`}
        aria-label="Navegación principal"
      >
        <div className="flex min-h-10 items-center px-2.5 pb-7">
          {collapsed ? (
            <span
              className="grid h-8 w-8 place-items-center rounded-panel bg-primary text-sm font-semibold text-white"
              title="NodeProx"
            >
              N
            </span>
          ) : (
            <Image
              src="/branding/nodeprox-logo.png"
              alt="NodeProx"
              width={160}
              height={40}
              className="h-auto w-40 object-contain"
            />
          )}
        </div>
        <nav className="grid gap-5">
          {sections.map((section) => (
            <section key={section.id} className="grid gap-1">
              <h2
                className={`px-2.5 text-[10px] font-bold uppercase tracking-[0.12em] text-sidebar-muted ${collapsed ? "sr-only" : ""}`}
              >
                {section.label}
              </h2>
              {section.items.map((item) => (
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
            </section>
          ))}
        </nav>
        <button
          className="mt-auto hidden min-h-control rounded-panel border border-sidebar-border bg-sidebar-elevated text-sidebar-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary md:inline-flex md:items-center md:justify-center min-[1280px]:hidden max-[767px]:hidden"
          type="button"
          onClick={() => setCollapsed((value) => !value)}
          aria-label={collapsed ? "Expandir navegación" : "Colapsar navegación"}
          aria-pressed={collapsed}
        >
          {collapsed ? "→" : "←"}
        </button>
      </aside>
    </MobileDrawer>
  );
}
