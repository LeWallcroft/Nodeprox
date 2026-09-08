"use client";

import { Link2 } from "lucide-react";
import { useState } from "react";
import { ApiError } from "../../../lib/api/types";
import { useGenerateDiscordLinkCode } from "../../../lib/domains/discord-identity/hooks";
import type { DiscordLinkCodeResponse } from "../../../lib/domains/discord-identity/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { CopyButton } from "../../ui/copy-button";

function expirationText(expiresInSeconds: number) {
  const minutes = Math.max(1, Math.ceil(expiresInSeconds / 60));
  return `Este código expira en aproximadamente ${minutes} minutos y sólo puede utilizarse una vez.`;
}

function linkCodeError(error: unknown) {
  if (error instanceof ApiError && error.status === 401)
    return "Tu sesión no es válida o ha expirado.";
  if (error instanceof ApiError && error.status === 429)
    return "Has realizado demasiadas solicitudes. Inténtalo nuevamente en unos minutos.";
  return "No se pudo generar el código de vinculación. Inténtalo nuevamente.";
}

export function DiscordLinkSection() {
  const generate = useGenerateDiscordLinkCode();
  const [linkCode, setLinkCode] = useState<DiscordLinkCodeResponse | null>(
    null,
  );

  return (
    <Card className="max-w-2xl space-y-5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary"
        >
          <Link2 className="size-5" />
        </span>
        <div>
          <h2 className="m-0 text-lg font-semibold text-text">Discord</h2>
          <p className="mt-1 text-sm text-muted">
            Conecta tu cuenta de Discord con NodeProx.
          </p>
        </div>
      </div>

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
          : linkCode
            ? "Generar un nuevo código"
            : "Generar código de vinculación"}
      </Button>

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
            {expirationText(linkCode.expiresInSeconds)}
          </p>
        </div>
      ) : null}
    </Card>
  );
}
