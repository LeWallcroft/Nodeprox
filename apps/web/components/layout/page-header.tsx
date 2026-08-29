import type { ReactNode } from "react";
import Link from "next/link";
import { Breadcrumbs } from "./breadcrumbs";
import type { BreadcrumbItem } from "../../lib/navigation/types";
import { ArrowLeft } from "lucide-react";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
  back,
}: {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
  back?: { label: string; href: string };
}) {
  return (
    <div className="mb-section grid gap-3">
      {back ? (
        <Link
          className="inline-flex min-h-control w-fit items-center gap-2 rounded-control border border-border bg-surface px-3 text-sm font-medium text-secondary transition-colors hover:bg-surface-hover hover:text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
          href={back.href}
        >
          <ArrowLeft aria-hidden="true" className="size-4" /> {back.label}
        </Link>
      ) : null}
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}
      <div className="flex items-end justify-between gap-5 max-[640px]:flex-col max-[640px]:items-stretch">
        <div>
          <h2 className="m-0 text-[28px] font-semibold tracking-[-0.02em]">
            {title}
          </h2>
          {description ? (
            <p className="mt-1.5 text-muted">{description}</p>
          ) : null}
        </div>
        {actions ? <div>{actions}</div> : null}
      </div>
    </div>
  );
}
