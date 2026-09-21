"use client";

import Link from "next/link";
import { type FormEvent, useState } from "react";
import { Button } from "../../../components/ui/button";
import { useRequestPasswordReset } from "../../../lib/domains/account/hooks";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const request = useRequestPasswordReset();
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await request.mutateAsync(email);
    setSent(true);
  }
  return (
    <main className="grid min-h-screen place-items-center p-page-mobile">
      <section className="w-full max-w-[420px] rounded-panel border border-[var(--border-subtle)] bg-surface-elevated p-7 shadow-panel sm:p-8">
        <Link
          className="text-sm font-medium text-primary hover:text-primary-hover"
          href="/login"
        >
          ← Volver al inicio
        </Link>
        <h1 className="mt-6 text-2xl font-semibold">Recuperar contraseña</h1>
        {sent ? (
          <div className="mt-5 rounded-control border border-primary/40 bg-primary-soft p-4 text-sm text-text">
            Si la cuenta existe y puede recibir correo, enviamos las
            instrucciones para restablecer tu contraseña.
          </div>
        ) : (
          <form
            className="mt-5 grid gap-4"
            onSubmit={(event) => void submit(event)}
          >
            <p className="m-0 text-sm text-secondary">
              Te enviaremos un enlace seguro a tu correo electrónico.
            </p>
            <label className="grid gap-1 text-sm">
              Correo electrónico
              <input
                required
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            {request.isError ? (
              <p className="m-0 text-sm text-danger">
                No se pudo procesar la solicitud. Inténtalo nuevamente.
              </p>
            ) : null}
            <Button loading={request.isPending} type="submit">
              Enviar enlace
            </Button>
          </form>
        )}
      </section>
    </main>
  );
}
