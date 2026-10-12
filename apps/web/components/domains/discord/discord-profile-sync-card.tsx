"use client";

import { CircleAlert, LoaderCircle, RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  useDiscordProfileSyncStatus,
  useTriggerDiscordProfileSync,
} from "../../../lib/domains/discord/profile-sync-hooks";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { StatusBadge } from "../../ui/status-badge";
import { errorMessage } from "../feedback";

export function DiscordProfileSyncCard() {
  const status = useDiscordProfileSyncStatus();
  const trigger = useTriggerDiscordProfileSync();
  const [feedback, setFeedback] = useState<string | null>(null);
  const isRunning = status.data?.syncRunning === true;
  const onTrigger = async () => {
    setFeedback(null);
    try {
      const result = await trigger.mutateAsync();
      setFeedback(
        result.accepted
          ? "Sincronización iniciada"
          : "Ya hay una sincronización en curso.",
      );
    } catch {
      setFeedback(null);
    }
  };
  const stateLabel = status.isError
    ? "Estado no disponible"
    : status.isPending
      ? "Consultando estado…"
      : isRunning
        ? "Sincronizando"
        : status.data?.staleProfiles === 0
          ? "Perfiles actualizados"
          : "Hay perfiles pendientes de actualización.";
  const stateTone = status.isError
    ? "warning"
    : isRunning
      ? "neutral"
      : status.data?.staleProfiles === 0
        ? "success"
        : "warning";

  return (
    <Card className="p-5" aria-labelledby="discord-profile-sync-title">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
            <RefreshCw
              aria-hidden="true"
              className={`size-5 ${isRunning ? "animate-spin" : ""}`}
            />
          </span>
          <div>
            <p className="m-0 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
              Identidad vinculada
            </p>
            <h3
              id="discord-profile-sync-title"
              className="m-0 text-lg font-semibold"
            >
              Perfiles vinculados
            </h3>
            <p className="mb-0 mt-1 text-sm text-muted">
              Mantiene actualizados el nombre y avatar de las cuentas vinculadas
              sin alterar su vínculo con NodeProx.
            </p>
          </div>
        </div>
        <StatusBadge label={stateLabel} tone={stateTone} />
      </div>
      {status.isError ? (
        <div
          className="mt-4 flex items-start gap-2 rounded-control bg-warning-soft p-3 text-sm text-warning"
          role="status"
        >
          <CircleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            No se pudo consultar el estado de los perfiles de Discord.
          </span>
        </div>
      ) : status.data ? (
        <dl className="mt-4 grid gap-3 rounded-control bg-surface p-4 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted">Cuentas vinculadas</dt>
            <dd className="mb-0 mt-1 font-semibold text-text">
              {status.data.linkedUsers}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Avatares faltantes</dt>
            <dd className="mb-0 mt-1 font-semibold text-text">
              {status.data.missingAvatar}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Perfiles pendientes de refresco</dt>
            <dd className="mb-0 mt-1 font-semibold text-text">
              {status.data.staleProfiles}
            </dd>
          </div>
          <div>
            <dt className="text-muted">Sincronización más antigua</dt>
            <dd className="mb-0 mt-1 font-semibold text-text">
              {status.data.oldestSyncedAt
                ? new Date(status.data.oldestSyncedAt).toLocaleString("es-PE")
                : "Aún no sincronizada"}
            </dd>
          </div>
        </dl>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div aria-live="polite" className="min-w-0 text-sm text-secondary">
          {trigger.isError ? (
            <span role="alert">
              {errorMessage(trigger.error) ??
                "No se pudo iniciar la sincronización de perfiles de Discord."}
            </span>
          ) : (
            feedback
          )}
        </div>
        <Button
          type="button"
          variant="secondary"
          disabled={trigger.isPending || isRunning}
          onClick={() => void onTrigger()}
          icon={
            trigger.isPending || isRunning ? (
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin"
              />
            ) : (
              <RefreshCw aria-hidden="true" className="size-4" />
            )
          }
        >
          {trigger.isPending
            ? "Iniciando sincronización…"
            : isRunning
              ? "Sincronizando perfiles…"
              : "Sincronizar perfiles de Discord"}
        </Button>
      </div>
    </Card>
  );
}
