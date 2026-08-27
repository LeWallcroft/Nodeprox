import { redirect } from "next/navigation";
import { AppShell } from "../../components/layout/app-shell";
import { getSession } from "../../lib/auth/session";
import { getCapabilities } from "../../lib/domains/auth/server";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const session = await getSession();
  if (!session) redirect("/login");
  const projection = await getCapabilities();
  return (
    <AppShell user={session.user} capabilities={projection.capabilities}>
      {children}
    </AppShell>
  );
}
