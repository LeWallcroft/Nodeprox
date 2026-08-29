import { redirect } from "next/navigation";
import { AppShell } from "../../components/layout/app-shell";
import { getSession } from "../../lib/auth/session";
import { getCapabilities } from "../../lib/domains/auth/server";
import { ApiError } from "../../lib/api/types";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  let session: Awaited<ReturnType<typeof getSession>>;
  try {
    session = await getSession();
  } catch (cause) {
    if (cause instanceof ApiError && cause.code === "account-pending")
      redirect("/account-pending");
    if (cause instanceof ApiError && cause.status === 403) redirect("/login");
    throw cause;
  }
  if (!session) redirect("/login");
  const projection = await getCapabilities();
  return (
    <AppShell user={session.user} capabilities={projection.capabilities}>
      {children}
    </AppShell>
  );
}
