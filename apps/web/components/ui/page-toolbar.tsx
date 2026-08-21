import type { ReactNode } from "react";
import { SearchInput } from "./search-input";

export function PageToolbar({ children }: { children?: ReactNode }) {
  return (
    <div className="page-toolbar">
      <div>
        <SearchInput />
      </div>
      {children ? <div className="toolbar-actions">{children}</div> : null}
    </div>
  );
}
