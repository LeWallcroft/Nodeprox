"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, type FormEvent } from "react";
import { errorMessage } from "../../../components/domains/feedback";
import { useRegister } from "../../../lib/domains/auth/hooks";
import { ACCOUNT_PENDING_PATH } from "../../../lib/domains/auth/registration";

export default function RegisterPage() {
  const registration = useRegister();
  const [email, setEmail] = useState("");
  const [discordUsername, setDiscordUsername] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError("Las contraseñas no coinciden.");
      return;
    }
    try {
      await registration.mutateAsync({ email, discordUsername, password });
      window.location.assign(ACCOUNT_PENDING_PATH);
    } catch (cause) {
      setError(errorMessage(cause, "No se pudo crear la cuenta."));
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-page-mobile">
      <section className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-8 shadow-panel">
        <Image
          src="/branding/nodeprox-logo.png"
          alt="NodeProx"
          className="mb-5 h-10 w-auto"
          width={160}
          height={40}
        />
        <h1 className="mb-2 mt-0 text-2xl font-semibold">Crear cuenta</h1>
        <p className="text-muted">
          El acceso quedará pendiente de aprobación administrativa.
        </p>
        <form className="mt-6 grid gap-3.5" onSubmit={submit}>
          <label className="grid gap-1.5 text-[13px] font-medium text-muted">
            Usuario de Discord
            <input
              required
              value={discordUsername}
              onChange={(event) => setDiscordUsername(event.target.value)}
            />
            <span className="text-xs font-normal">
              Usa el mismo nombre con el que te identificas en Discord.
            </span>
          </label>
          <label className="grid gap-1.5 text-[13px] font-bold text-muted">
            Email
            <input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-[13px] font-bold text-muted">
            Contraseña
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <label className="grid gap-1.5 text-[13px] font-bold text-muted">
            Confirmar contraseña
            <input
              type="password"
              autoComplete="new-password"
              minLength={8}
              required
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
            />
          </label>
          {error ? <p className="text-[13px] text-danger">{error}</p> : null}
          <button
            className="inline-flex min-h-control items-center justify-center rounded-lg border border-transparent bg-primary px-3.5 font-semibold text-white disabled:opacity-60"
            type="submit"
            disabled={registration.isPending}
          >
            {registration.isPending ? "Creando…" : "Crear cuenta"}
          </button>
        </form>
        <p className="mt-5 text-center text-[13px] text-muted">
          <Link className="font-semibold text-primary" href="/login">
            Volver a iniciar sesión
          </Link>
        </p>
      </section>
    </main>
  );
}
