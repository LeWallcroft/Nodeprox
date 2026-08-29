import Link from "next/link";
import type { BreadcrumbItem } from "../../lib/navigation/types";

export function Breadcrumbs({ items }: { items: BreadcrumbItem[] }) {
  return (
    <nav
      className="flex flex-wrap gap-2 text-[13px] text-muted"
      aria-label="Breadcrumbs"
    >
      {items.map((item) => (
        <span
          key={`${item.href ?? item.label}-${item.current ? "current" : "item"}`}
        >
          {item.href && !item.current ? (
            <Link href={item.href}>{item.label}</Link>
          ) : (
            <span aria-current={item.current ? "page" : undefined}>
              {item.label}
            </span>
          )}
          {item !== items.at(-1) ? (
            <span className="ml-2 text-muted" aria-hidden="true">
              /
            </span>
          ) : null}
        </span>
      ))}
    </nav>
  );
}
