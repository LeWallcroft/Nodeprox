"use client";

import { CheckCircle2, Link2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/api/types";
import {
  useDiscordLinkStatus,
  useGenerateDiscordLinkCode,
} from "../../../lib/domains/discord-identity/hooks";
import type {
  DiscordLinkCodeResponse,
  DiscordLinkStatus,
} from "../../../lib/domains/discord-identity/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { CopyButton } from "../../ui/copy-button";

function expirationText(expiresAt: string) {
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000),
  );
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `Este código expira en aproximadamente ${minutes} minutos y sólo puede utilizarse una vez.`;
}

function linkCodeError(error: unknown) {
  if (!(error instanceof ApiError))
    return "No se pudo generar el código de vinculación. Inténtalo nuevamente.";
  if (error.status === 401) return "Tu sesión no es válida o ha expirado.";
  if (error.status === 429)
    return "Has realizado demasiadas solicitudes. Inténtalo nuevamente en unos minutos.";
  if (error.code === "discord-link-already-exists")
    return "Esta cuenta de NodeProx ya tiene una cuenta de Discord vinculada.";
  return "No se pudo generar el código de vinculación. Inténtalo nuevamente.";
}

function linkedAtText(linkedAt: string | null) {
  if (!linkedAt) return "Tu identidad Discord quedó conectada con NodeProx.";
  return `Vinculada el ${new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(linkedAt))}.`;
}

function pendingLinkStatus(status: DiscordLinkStatus | undefined) {
  return status?.state === "pending" ? status : undefined;
}

function linkedLinkStatus(status: DiscordLinkStatus | undefined) {
  return status?.state === "linked" ? status : undefined;
}

export function DiscordLinkSection() {
  const status = useDiscordLinkStatus();
  const generate = useGenerateDiscordLinkCode();
  const [linkCode, setLinkCode] = useState<DiscordLinkCodeResponse | null>(
    null,
  );

  useEffect(() => {
    if (status.data?.state === "linked") setLinkCode(null);
  }, [status.data?.state]);

  const pendingStatus = pendingLinkStatus(status.data);
  const linkedStatus = linkedLinkStatus(status.data);
  const pending = Boolean(pendingStatus);
  const linked = Boolean(linkedStatus);

  return (
    <Card className="max-w-2xl space-y-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary"
        >
          {linked ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <Link2 className="size-5" />
          )}
        </span>
        <div>
          <h2 className="m-0 text-lg font-semibold text-text">Discord</h2>
          <p className="mt-1 text-sm text-muted">
            {linked
              ? "Discord vinculado"
              : "Vincula tu cuenta de Discord para utilizar las funciones de autorización e integración de NodeProx."}
          </p>
        </div>
      </div>

      {linked ? (
        <p className="m-0 text-sm text-success">
          {linkedAtText(linkedStatus?.linkedAt ?? null)}
        </p>
      ) : (
        <Button
          type="button"
          disabled={generate.isPending}
          onClick={() =>
            generate.mutate(undefined, {
              onSuccess: (result) => setLinkCode(result),
            })
          }
        >
          <Link2 aria-hidden="true" className="size-4" />
          {generate.isPending
            ? "Generando código…"
            : pending || linkCode
              ? "Generar un nuevo código"
              : "Vincular Discord"}
        </Button>
      )}

      {generate.isError ? (
        <p className="text-sm text-danger" role="alert">
          {linkCodeError(generate.error)}
        </p>
      ) : null}

      {linkCode ? (
        <div className="space-y-4 rounded-control border border-primary/40 bg-primary-soft/30 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="m-0 text-sm font-semibold text-text">
                Código de vinculación
              </p>
              <code className="mt-1 block break-all text-base font-semibold tracking-wide text-primary">
                {linkCode.code}
              </code>
            </div>
            <CopyButton
              value={linkCode.code}
              label="Copiar código"
              successLabel="Código copiado"
              failureMessage="No se pudo copiar el código."
            />
          </div>
          <ol className="m-0 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Abre Discord.</li>
            <li>Ve al canal de control de NodeProx.</li>
            <li>
              Ejecuta: <code>/vincular codigo:{linkCode.code}</code>
            </li>
          </ol>
          <p className="m-0 text-sm text-muted">
            {expirationText(linkCode.expiresAt)}
          </p>
        </div>
      ) : pending ? (
        <div className="rounded-control border border-warning/40 bg-warning-soft/30 p-4 text-sm text-muted">
          <p className="m-0 font-semibold text-text">
            Tienes un código de vinculación pendiente.
          </p>
          <p className="mt-1 mb-0">
            El código no se muestra de nuevo por seguridad. Genera uno nuevo si
            ya no lo tienes.
          </p>
          <p className="mt-2 mb-0">
            {pendingStatus ? expirationText(pendingStatus.expiresAt) : null}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
