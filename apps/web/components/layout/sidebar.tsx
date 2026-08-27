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
      className={`flex min-h-control items-center gap-3 rounded-lg px-2.5 text-[#aebbd0] hover:bg-[#1e3150] hover:text-white focus-visible:bg-[#1e3150] focus-visible:text-white focus-visible:outline-none ${active ? "bg-[#1e3150] text-white" : ""}`}
      href={item.href}
      aria-current={active ? "page" : undefined}
      title={collapsed ? item.label : undefined}
    >
      <span
        className="inline-grid w-5 shrink-0 place-items-center"
        aria-hidden="true"
      >
        {item.icon}
      </span>
      <span className={collapsed ? "hidden max-[640px]:inline" : ""}>
        {item.label}
      </span>
    </Link>
  ) : (
    <span className="mt-4 flex min-h-control items-center gap-3 px-2.5 text-xs uppercase text-[#71839d]">
      <span
        className="inline-grid w-5 shrink-0 place-items-center"
        aria-hidden="true"
      >
        {item.icon}
      </span>
      <span className={collapsed ? "hidden max-[640px]:inline" : ""}>
        {item.label}
      </span>
    </span>
  );
}

export function Sidebar({ capabilities }: { capabilities: readonly string[] }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const capabilitySet = new Set(capabilities);

  useEffect(() => {
    const open = () => setMobileOpen(true);
    window.addEventListener("nodeprox:open-mobile-nav", open);
    return () => window.removeEventListener("nodeprox:open-mobile-nav", open);
  }, []);

  return (
    <>
      {mobileOpen ? (
        <button
          className="fixed inset-0 z-[9] border-0 bg-[#101a2a66]"
          type="button"
          aria-label="Cerrar navegación"
          onClick={() => setMobileOpen(false)}
        />
      ) : null}
      <aside
        className={`relative z-10 flex min-h-screen w-sidebar shrink-0 flex-col bg-[#101a2a] px-3 py-5 text-[#dce5f2] transition-[width,flex-basis,transform] duration-200 ease-in-out ${collapsed ? "w-sidebar-collapsed" : ""} ${mobileOpen ? "max-[640px]:translate-x-0" : ""} max-[640px]:fixed max-[640px]:h-screen max-[640px]:-translate-x-full max-[640px]:w-sidebar`}
        aria-label="Navegación principal"
      >
        <div className="flex min-h-10 items-center gap-2.5 px-2.5 pb-6 font-bold">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-[#5b83ff] text-white">
            N
          </span>
          <span className={collapsed ? "hidden" : ""}>NodeProx</span>
        </div>
        <nav className="grid gap-1">
          {navigationConfig
            .filter(
              (item) =>
                !item.capabilityKey || capabilitySet.has(item.capabilityKey),
            )
            .map((item) => (
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
          className="mt-auto min-h-control rounded-lg border border-[#354663] bg-transparent text-[#dce5f2] focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
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
