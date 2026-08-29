import Link from "next/link";
import Image from "next/image";

export default function AccountPendingPage() {
  return (
    <main className="grid min-h-screen place-items-center p-page-mobile">
      <section className="w-full max-w-[520px] rounded-2xl border border-border bg-surface p-8 text-center shadow-panel">
        <Image
          src="/branding/nodeprox-logo.png"
          alt="NodeProx"
          className="mx-auto mb-5 h-10 w-auto"
          width={160}
          height={40}
        />
        <h1 className="mb-2 mt-2 text-2xl font-semibold">Cuenta pendiente</h1>
        <p className="text-muted">
          Tu registro se completó correctamente. Un administrador debe aprobar
          tu cuenta antes de que puedas acceder a NodeProx.
        </p>
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
