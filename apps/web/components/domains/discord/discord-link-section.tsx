"use client";

import {
  CheckCircle2,
  CircleCheck,
  ExternalLink,
  Link2,
  MessageCircle,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
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
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { CopyButton } from "../../ui/copy-button";
import { StatusBadge } from "../../ui/status-badge";

function expirationText(expiresAt: string) {
  const seconds = Math.max(
    0,
    Math.ceil((Date.parse(expiresAt) - Date.now()) / 1000),
  );
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `El código expira en aproximadamente ${minutes} minutos y sólo puede utilizarse una vez.`;
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

function formatLinkedAt(linkedAt: string | null) {
  if (!linkedAt) return "Fecha de vinculación no disponible.";
  return new Intl.DateTimeFormat("es-PE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(linkedAt));
}

function pendingLinkStatus(status: DiscordLinkStatus | undefined) {
  return status?.state === "pending" ? status : undefined;
}

function linkedLinkStatus(status: DiscordLinkStatus | undefined) {
  return status?.state === "linked" ? status : undefined;
}

export function DiscordLinkSection({
  embedded = false,
}: {
  embedded?: boolean;
}) {
  const status = useDiscordLinkStatus();
  const generate = useGenerateDiscordLinkCode();
  const [linkCode, setLinkCode] = useState<DiscordLinkCodeResponse | null>(
    null,
  );
  const [dialogOpen, setDialogOpen] = useState(false);

  useEffect(() => {
    if (status.data?.state === "linked") {
      setLinkCode(null);
      setDialogOpen(false);
    }
  }, [status.data?.state]);

  const pendingStatus = pendingLinkStatus(status.data);
  const linkedStatus = linkedLinkStatus(status.data);
  const linked = Boolean(linkedStatus);

  async function openLinkDialog() {
    setDialogOpen(true);
    if (pendingStatus || linkCode) return;
    try {
      const result = await generate.mutateAsync();
      setLinkCode(result);
    } catch {
      // The contextual error is rendered inside the dialog.
    }
  }

  const content = (
    <div className={embedded ? "grid gap-3" : "grid gap-5"}>
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
          {linked ? (
            <CheckCircle2 aria-hidden="true" className="size-5" />
          ) : (
            <MessageCircle aria-hidden="true" className="size-5" />
          )}
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="m-0 text-lg font-semibold text-text">Discord</h2>
            <StatusBadge
              label={linked ? "Vinculado" : "No vinculado"}
              tone={linked ? "success" : "danger"}
            />
          </div>
          <p className="mt-1 mb-0 text-sm text-secondary">
            {linked
              ? "Tu cuenta Discord está vinculada a NodeProx."
              : "Vincula tu cuenta para recibir funciones y notificaciones desde el servidor."}
          </p>
        </div>
      </div>

      {linked && linkedStatus ? (
        <div className="rounded-control border border-[var(--border-subtle)] bg-surface p-3">
          <p className="m-0 truncate text-sm font-medium text-text">
            {linkedStatus.discordUsername ?? "Usuario de Discord"}
          </p>
          <p className="mt-1 mb-0 truncate text-xs text-secondary">
            ID de Discord: {linkedStatus.discordId}
          </p>
          <p className="mt-1 mb-0 text-xs text-secondary">
            Vinculado el {formatLinkedAt(linkedStatus.linkedAt)}
          </p>
        </div>
      ) : null}

      {linked ? (
        <Button
          icon={<ShieldCheck aria-hidden="true" className="size-4" />}
          onClick={() => setDialogOpen(true)}
          type="button"
          variant="secondary"
        >
          Ver estado
        </Button>
      ) : (
        <Button
          icon={<Link2 aria-hidden="true" className="size-4" />}
          loading={generate.isPending && !dialogOpen}
          onClick={() => void openLinkDialog()}
          type="button"
        >
          Vincular Discord
        </Button>
      )}
    </div>
  );

  return (
    <>
      {embedded ? content : <Card className="max-w-2xl">{content}</Card>}
      <DiscordLinkDialog
        code={linkCode}
        error={generate.isError ? linkCodeError(generate.error) : null}
        linked={linkedStatus}
        loading={generate.isPending}
        onClose={() => setDialogOpen(false)}
        onRefresh={() => void status.refetch()}
        onRegenerate={() =>
          void generate
            .mutateAsync()
            .then(setLinkCode)
            .catch(() => undefined)
        }
        open={dialogOpen}
        pending={pendingStatus}
      />
    </>
  );
}

function DiscordLinkDialog({
  code,
  error,
  linked,
  loading,
  onClose,
  onRefresh,
  onRegenerate,
  open,
  pending,
}: {
  code: DiscordLinkCodeResponse | null;
  error: string | null;
  linked: Extract<DiscordLinkStatus, { state: "linked" }> | undefined;
  loading: boolean;
  onClose: () => void;
  onRefresh: () => void;
  onRegenerate: () => void;
  open: boolean;
  pending: Extract<DiscordLinkStatus, { state: "pending" }> | undefined;
}) {
  const activeCode = code?.code;
  const expiresAt = code?.expiresAt ?? pending?.expiresAt;
  const command = activeCode ? `/vincular codigo:${activeCode}` : null;
  const linkedState = Boolean(linked);

  return (
    <AppDialog
      description={
        linkedState
          ? "Estado actual de tu cuenta conectada."
          : "Conecta tu cuenta de NodeProx con Discord de manera segura."
      }
      footer={
        linkedState ? (
          <div className="flex justify-end">
            <Button
              icon={<RefreshCw className="size-4" />}
              onClick={onRefresh}
              variant="secondary"
            >
              Actualizar estado
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button onClick={onClose} variant="secondary">
              Cancelar
            </Button>
            <Button loading={loading} onClick={onRegenerate}>
              Regenerar código
            </Button>
          </div>
        )
      }
      onOpenChange={(next) => !next && onClose()}
      open={open}
      size="md"
      title={
        linkedState
          ? "Estado de la integración con Discord"
          : "Vincular cuenta de Discord"
      }
    >
      {linkedState && linked ? (
        <DiscordLinkedStatus linked={linked} />
      ) : (
        <div className="grid gap-4">
          <LinkStep number="1" title="Copia el código">
            <p>Usa el código único generado para tu cuenta.</p>
            {activeCode ? (
              <div className="grid min-w-0 gap-3 rounded-control border border-[var(--border-subtle)] bg-primary-soft/25 p-3">
                <code className="min-w-0 break-all text-lg font-semibold tracking-[0.12em] text-text">
                  {activeCode}
                </code>
                <div className="justify-self-start">
                  <CopyButton
                    label="Copiar"
                    successLabel="Copiado"
                    value={activeCode}
                  />
                </div>
              </div>
            ) : (
              <p className="m-0 rounded-control border border-[var(--border-subtle)] bg-warning-soft/30 p-3 text-sm text-secondary">
                El código anterior no se muestra otra vez por seguridad. Genera
                uno nuevo para continuar.
              </p>
            )}
          </LinkStep>
          <LinkStep number="2" title="Ejecuta el comando en Discord">
            <p>
              En el servidor de NodeProx, escribe este comando en cualquier
              canal de texto.
            </p>
            <div className="flex min-w-0 items-start gap-3 rounded-control border border-[var(--border-subtle)] bg-surface p-3">
              <code className="min-w-0 flex-1 break-all text-sm font-semibold text-primary">
                {command ?? "/vincular codigo:…"}
              </code>
              <div className="shrink-0">
                <CopyButton
                  label="Copiar"
                  successLabel="Copiado"
                  value={command}
                />
              </div>
            </div>
          </LinkStep>
          <LinkStep number="3" title="¡Listo!">
            <p>
              La cuenta se vinculará automáticamente al confirmar el comando en
              Discord.
            </p>
          </LinkStep>
          {expiresAt ? (
            <div className="rounded-control border border-[var(--border-subtle)] bg-primary-soft/20 p-3 text-sm text-secondary">
              {expirationText(expiresAt)}
            </div>
          ) : null}
          {error ? (
            <p className="m-0 text-sm text-danger" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      )}
    </AppDialog>
  );
}

function LinkStep({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-3">
      <span className="grid size-8 place-items-center rounded-full border border-primary bg-primary-soft text-sm font-semibold text-primary">
        {number}
      </span>
      <div className="grid gap-2">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
        <div className="grid gap-2 text-sm text-secondary [&>p]:m-0">
          {children}
        </div>
      </div>
    </div>
  );
}

function DiscordLinkedStatus({
  linked,
}: {
  linked: Extract<DiscordLinkStatus, { state: "linked" }>;
}) {
  return (
    <div className="grid gap-4">
      <div className="rounded-control border border-[var(--border-subtle)] bg-surface p-4">
        <div className="flex items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft text-primary">
            <MessageCircle aria-hidden="true" className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 truncate font-semibold">
                {linked.discordUsername ?? "Usuario de Discord"}
              </p>
              <StatusBadge label="Vinculado" tone="success" />
            </div>
            <p className="mt-1 mb-0 truncate text-xs text-secondary">
              ID de Discord: {linked.discordId}
            </p>
            <p className="mt-1 mb-0 text-xs text-secondary">
              Vinculado el {formatLinkedAt(linked.linkedAt)}
            </p>
          </div>
        </div>
      </div>
      <div className="grid gap-2 border-t border-[var(--border-subtle)] pt-4 text-sm text-secondary">
        <StatusLine label="Cuenta verificada" />
        <StatusLine label="Puede recibir notificaciones" />
        <StatusLine label="Acceso al servidor activo" />
      </div>
      <a
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover"
        href="https://discord.com/app"
        rel="noreferrer"
        target="_blank"
      >
        Abrir Discord <ExternalLink aria-hidden="true" className="size-4" />
      </a>
    </div>
  );
}

function StatusLine({ label }: { label: string }) {
  return (
    <p className="m-0 flex items-center gap-2">
      <CircleCheck
        aria-hidden="true"
        className="size-4 shrink-0 text-success"
      />
      {label}
    </p>
  );
}
