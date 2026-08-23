import type { ReactNode } from "react";
import { Breadcrumbs } from "./breadcrumbs";
import type { BreadcrumbItem } from "../../lib/navigation/types";

export function PageHeader({
  title,
  description,
  breadcrumbs,
  actions,
}: {
  title: string;
  description?: string;
  breadcrumbs?: BreadcrumbItem[];
  actions?: ReactNode;
}) {
  return (
    <div className="mb-section grid gap-3">
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
