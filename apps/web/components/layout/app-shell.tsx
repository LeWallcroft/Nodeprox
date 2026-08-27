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
    <div className="flex min-h-screen bg-background">
      <Sidebar capabilities={capabilities} />
      <div className="min-w-0 flex-1">
        <Topbar user={user} />
        <main className="mx-auto w-full max-w-content p-page max-[640px]:p-page-mobile">
          {children}
        </main>
      </div>
    </div>
  );
}
