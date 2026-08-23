"use client";

import { useState, type FormEvent } from "react";
import { useLogin } from "../../../lib/domains/auth/hooks";
import { errorMessage } from "../../../components/domains/feedback";

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
      setError(
        errorMessage(
          cause,
          "No se pudo iniciar sesión. Revisa tus credenciales.",
        ),
      );
    }
  }

  return (
    <main className="grid min-h-screen place-items-center p-page-mobile">
      <section
        className="w-full max-w-[420px] rounded-2xl border border-border bg-surface p-8 shadow-[0_16px_40px_#16243a12]"
        aria-labelledby="login-title"
      >
        <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
          NodeProx
        </span>
        <h1 id="login-title" className="mb-2 mt-0 text-2xl font-semibold">
          Iniciar sesión
        </h1>
        <p className="text-muted">Accede al workspace de operaciones.</p>
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
            Password
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
            <p className="text-[13px] text-[#a52f2f]" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="inline-flex min-h-control items-center justify-center rounded-lg border border-transparent bg-primary px-3.5 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
            type="submit"
            disabled={login.isPending}
          >
            {login.isPending ? "Ingresando..." : "Ingresar"}
          </button>
        </form>
      </section>
    </main>
  );
}
