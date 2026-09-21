"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, type FormEvent, useState } from "react";
import { Button } from "../../../components/ui/button";
import { useCompletePasswordReset } from "../../../lib/domains/account/hooks";

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <main className="grid min-h-screen place-items-center p-page-mobile">
          <p className="text-sm text-muted">Cargando formulario…</p>
        </main>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const token = useSearchParams().get("token") ?? "";
  const complete = useCompletePasswordReset();
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [done, setDone] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    await complete.mutateAsync({ token, newPassword: password });
    setDone(true);
  }
  return (
    <main className="grid min-h-screen place-items-center p-page-mobile">
      <section className="w-full max-w-[420px] rounded-panel border border-[var(--border-subtle)] bg-surface-elevated p-7 shadow-panel sm:p-8">
        <h1 className="m-0 text-2xl font-semibold">Restablecer contraseña</h1>
        {done ? (
          <div className="mt-5 grid gap-4 text-center">
            <p className="m-0 text-success">
              Tu contraseña fue actualizada correctamente.
            </p>
            <Link className="text-primary" href="/login">
              Volver a iniciar sesión
            </Link>
          </div>
        ) : (
          <form
            className="mt-5 grid gap-4"
            onSubmit={(event) => void submit(event)}
          >
            <p className="m-0 text-sm text-secondary">
              Usa una contraseña de al menos 8 caracteres.
            </p>
            <label className="grid gap-1 text-sm">
              Nueva contraseña
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Confirmar contraseña
              <input
                required
                minLength={8}
                type="password"
                autoComplete="new-password"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </label>
            {confirmation && password !== confirmation ? (
              <p className="m-0 text-sm text-danger">
                Las contraseñas no coinciden.
              </p>
            ) : null}
            {complete.isError ? (
              <p className="m-0 text-sm text-danger">
                El enlace es inválido o expiró. Solicita uno nuevo.
              </p>
            ) : null}
            <Button
              disabled={
                !token || password.length < 8 || password !== confirmation
              }
              loading={complete.isPending}
              type="submit"
            >
              Actualizar contraseña
            </Button>
            <Link
              className="text-center text-sm text-primary"
              href="/forgot-password"
            >
              Solicitar nuevo enlace
            </Link>
          </form>
        )}
      </section>
    </main>
  );
}
