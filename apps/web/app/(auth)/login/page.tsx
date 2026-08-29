"use client";

import { useState, type FormEvent } from "react";
import { useLogin } from "../../../lib/domains/auth/hooks";
import { errorMessage } from "../../../components/domains/feedback";
import { ApiError } from "../../../lib/api/types";
import Link from "next/link";
import Image from "next/image";

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
        className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-8 shadow-panel"
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
        <p className="text-muted">Accede al panel de NodeProx.</p>
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
          <button
            className="inline-flex min-h-control items-center justify-center rounded-lg border border-transparent bg-primary px-3.5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={login.isPending}
          >
            {login.isPending ? "Ingresando..." : "Iniciar sesión"}
          </button>
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
