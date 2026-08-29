import type { ReactNode } from "react";
import type { AuthenticatedUserView } from "../../lib/api/types";
import { Sidebar } from "./sidebar";
import { Topbar } from "./topbar";

export function AppShell({
  children,
  user,
  capabilities,
}: {
  children: ReactNode;
  user: AuthenticatedUserView | null;
  capabilities: readonly string[];
}) {
  return (
    <div className="flex h-dvh overflow-hidden bg-background">
      <Sidebar capabilities={capabilities} />
      <div className="flex h-dvh min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <Topbar user={user} />
        <main className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
          <div className="mx-auto w-full max-w-content p-page max-[767px]:p-page-mobile">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
