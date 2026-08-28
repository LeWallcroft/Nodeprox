import Link from "next/link";
import { ACCOUNT_PENDING_MESSAGE } from "../../../lib/domains/auth/registration";

export default function AccountPendingPage() {
  return (
    <main className="grid min-h-screen place-items-center p-page-mobile">
      <section className="w-full max-w-[520px] rounded-2xl border border-border bg-surface p-8 text-center shadow-[0_16px_40px_#16243a12]">
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
          NodeProx
        </span>
        <h1 className="mb-2 mt-2 text-2xl font-semibold">Cuenta pendiente</h1>
        <p className="text-muted">{ACCOUNT_PENDING_MESSAGE}</p>
        <Link
          className="mt-6 inline-flex min-h-control items-center justify-center rounded-lg bg-primary px-4 font-semibold text-white"
          href="/login"
        >
          Volver al inicio de sesión
        </Link>
      </section>
    </main>
  );
}
