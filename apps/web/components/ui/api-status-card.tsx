"use client";

import { useQuery } from "@tanstack/react-query";
import { getApiHealth } from "../../lib/api/health";
import { ApiError } from "../../lib/api/types";
import { ErrorState } from "./error-state";
import { Skeleton } from "./skeleton";
import { StatusBadge } from "./status-badge";

export function ApiStatusCard() {
  const query = useQuery({
    queryKey: ["system", "health"],
    queryFn: ({ signal }: { signal: AbortSignal }) => getApiHealth(signal),
    retry: false,
  });

  const testConnection = () => {
    void query.refetch();
  };

  return (
    <section
      className="rounded-xl border border-border bg-surface p-5"
      aria-labelledby="api-status-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
            Integración
          </span>
          <h3 id="api-status-title" className="mb-2 mt-0 text-lg font-semibold">
            Estado de API
          </h3>
        </div>
        <StatusBadge
          label={
            query.isLoading
              ? "Comprobando"
              : query.isSuccess
                ? "Conectada"
                : "Error"
          }
          tone={
            query.isLoading ? "warning" : query.isSuccess ? "success" : "danger"
          }
        />
      </div>
      {query.isLoading ? (
        <div
          className="mt-4 flex items-center justify-between gap-4 max-[640px]:flex-col max-[640px]:items-stretch"
          aria-live="polite"
        >
          <Skeleton />
          <span>Conectando con Fastify…</span>
        </div>
      ) : query.isError ? (
        <ErrorState
          title="No se pudo conectar con la API"
          description={
            query.error instanceof ApiError
              ? query.error.message
              : "Comprueba que el servicio esté disponible."
          }
          action={
            <button
              className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3.5 font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
              type="button"
              onClick={testConnection}
            >
              Test API Connection
            </button>
          }
        />
      ) : (
        <div
          className="mt-4 flex items-center justify-between gap-4 max-[640px]:flex-col max-[640px]:items-stretch"
          aria-live="polite"
        >
          <p className="m-0 text-muted">
            Fastify respondió correctamente al endpoint de lectura.
          </p>
          <button
            className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3.5 font-semibold text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"
            type="button"
            onClick={testConnection}
          >
            Test API Connection
          </button>
        </div>
      )}
    </section>
  );
}
