"use client";

import Image from "next/image";
import Link from "next/link";
import { type FormEvent, useState } from "react";
import { errorMessage } from "../../../components/domains/feedback";
import { Button } from "../../../components/ui/button";
import { ApiError } from "../../../lib/api/types";
import { useLogin } from "../../../lib/domains/auth/hooks";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const login = useLogin();

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ email, password });
      window.location.assign("/");
    } catch (cause) {
      if (cause instanceof ApiError && cause.code === "account-pending") {
        window.location.assign("/account-pending");
        return;
      }
      setError(loginErrorMessage(cause));
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-page-mobile">
      <section
        className="w-full max-w-[420px] rounded-panel border border-[var(--border-subtle)] bg-surface-elevated p-7 shadow-panel sm:p-8"
        aria-labelledby="login-title"
      >
        <Image
          src="/branding/nodeprox-logo.png"
          alt="NodeProx"
          className="mb-5 h-10 w-auto"
          width={160}
          height={40}
        />
        <h1 id="login-title" className="mb-2 mt-0 text-2xl font-semibold">
          Iniciar sesión
        </h1>
        <p className="text-secondary">Accede al panel de NodeProx.</p>
        <form className="mt-6 grid gap-3.5" onSubmit={handleSubmit}>
          <label
            className="grid gap-1.5 text-[13px] font-bold text-muted"
            htmlFor="email"
          >
            Email
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
          <Link
            className="-mt-1 text-right text-[13px] font-semibold text-primary"
            href="/forgot-password"
          >
            ¿Olvidaste tu contraseña?
          </Link>
          <label
            className="grid gap-1.5 text-[13px] font-bold text-muted"
            htmlFor="password"
          >
            Contraseña
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          {error ? (
            <p className="text-[13px] text-danger" role="alert">
              {error}
            </p>
          ) : null}
          <Button
            className="mt-1 w-full"
            type="submit"
            loading={login.isPending}
          >
            {login.isPending ? "Ingresando..." : "Iniciar sesión"}
          </Button>
        </form>
        <p className="mt-5 text-center text-[13px] text-muted">
          ¿No tienes cuenta?{" "}
          <Link className="font-semibold text-primary" href="/register">
            Crear cuenta
          </Link>
        </p>
      </section>
    </main>
  );
}

function loginErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) {
    if (cause.code === "invalid-credentials" || cause.status === 401)
      return "Email o contraseña incorrectos.";
    if (cause.status === 400 || cause.status === 422)
      return "Revisa el email y la contraseña ingresados.";
    if (cause.status >= 500)
      return "El servicio no está disponible temporalmente.";
  }
  return errorMessage(cause, "El servicio no está disponible temporalmente.");
}
