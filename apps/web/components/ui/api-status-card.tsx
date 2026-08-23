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
    <section className="panel" aria-labelledby="api-status-title">
      <div className="panel-heading">
        <div>
          <span className="eyebrow">Integración</span>
          <h3 id="api-status-title">Estado de API</h3>
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
        <div className="status-loading" aria-live="polite">
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
              className="button button-secondary"
              type="button"
              onClick={testConnection}
            >
              Test API Connection
            </button>
          }
        />
      ) : (
        <div className="status-success" aria-live="polite">
          <p>Fastify respondió correctamente al endpoint de lectura.</p>
          <button
            className="button button-secondary"
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
