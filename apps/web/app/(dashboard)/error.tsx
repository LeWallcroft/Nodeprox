"use client";

import { Button } from "../../components/ui/button";

export default function DashboardError({
  error,
  reset,
}: Readonly<{
  error: Error;
  reset: () => void;
}>) {
  const unavailable = error.message === "api-unavailable";
  return (
    <section className="grid max-w-lg gap-3 rounded-panel border border-border bg-surface-elevated p-6">
      <h1 className="m-0 text-xl font-semibold">
        {unavailable
          ? "No se pudo conectar con NodeProx"
          : "No se pudo cargar el panel"}
      </h1>
      <p className="m-0 text-sm text-muted">
        {unavailable
          ? "El servicio está temporalmente no disponible. Inténtalo nuevamente."
          : "Ocurrió un problema al cargar esta sección."}
      </p>
      <div>
        <Button type="button" onClick={reset}>
          Reintentar
        </Button>
      </div>
    </section>
  );
}
