import type { ReactNode } from "react";
import { SearchInput } from "./search-input";

export function PageToolbar({ children }: { children?: ReactNode }) {
  return (
    <div className="mb-section flex items-center justify-between gap-3 max-[640px]:flex-col max-[640px]:items-stretch">
      <div>
        <SearchInput />
      </div>
      {children ? <div className="flex gap-2">{children}</div> : null}
    </div>
  );
}
