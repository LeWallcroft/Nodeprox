import type { ReactNode } from "react";
import type { AuthenticatedUserView } from "../../lib/api/types";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  children,
  user,
}: {
  children: ReactNode;
  user: AuthenticatedUserView | null;
}) {
  return (
    <div className="app-shell">
      <Sidebar />
      <div className="shell-main">
        <Topbar user={user} />
        <main className="content-area">{children}</main>
      </div>
    </div>
  );
}
