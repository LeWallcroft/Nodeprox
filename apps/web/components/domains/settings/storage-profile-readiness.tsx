"use client";

import { CheckCircle2, Circle, LoaderCircle, XCircle } from "lucide-react";
import { useState } from "react";
import { storageProfileErrorMessage } from "../../../lib/domains/storage-profiles/presentation";
import type {
  StorageProfileReadiness as Readiness,
  StorageProfileDetail,
  StorageReadinessCheck,
} from "../../../lib/domains/storage-profiles/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { ConfirmationDialog } from "../../ui/confirmation-dialog";

const labels: Record<string, string> = {
  b2_credentials: "Credenciales",
  b2_bucket: "Bucket público",
  b2_cors: "CORS de carga",
  b2_lifecycle: "Limpieza temporal (Lifecycle)",
  b2_storage_probe: "Lectura/escritura del bucket",
  b2_browser_upload: "Carga directa del navegador",
  cloudflare_dns: "DNS",
  cloudflare_transform: "Reescritura de rutas",
  cloudflare_cache: "Caché",
  cloudflare_delivery: "Entrega pública",
};
const statuses: Record<StorageReadinessCheck["status"], string> = {
  pending: "Pendiente",
  checking: "Comprobando",
  verified: "Verificado",
  manual_required: "Requiere acción manual",
  failed: "No verificado",
};
const descriptions: Record<string, string> = {
  b2_credentials:
    "Comprueba que las credenciales administradas pueden acceder al bucket.",
  b2_bucket:
    "Verifica que el bucket existente permita la entrega pública requerida.",
  b2_cors:
    "Comprueba la configuración necesaria para PUT directo desde el navegador.",
  b2_lifecycle:
    "Verifica la limpieza de cargas temporales, sin afectar Media/.",
  b2_storage_probe: "Lee y escribe un objeto temporal de prueba en el bucket.",
  b2_browser_upload:
    "Comprueba la carga directa del navegador a B2 mediante CORS.",
  cloudflare_dns: "Verifica el hostname público administrado del perfil.",
  cloudflare_transform:
    "Comprueba la reescritura de rutas de entrega de media.",
  cloudflare_cache:
    "Verifica la regla compartida de caché para hosts administrados.",
  cloudflare_delivery:
    "Comprueba la entrega pública por el hostname del perfil.",
};
const cloudflareStatusLabels: Record<string, string> = {
  pending: "Pendiente",
  provisioning: "Configurando",
  verified: "Verificado",
  failed: "No verificado",
};

function statusIcon(status: StorageReadinessCheck["status"]) {
  if (status === "verified")
    return <CheckCircle2 aria-hidden="true" className="size-5 text-success" />;
  if (status === "failed" || status === "manual_required")
    return <XCircle aria-hidden="true" className="size-5 text-warning" />;
  if (status === "checking")
    return (
      <LoaderCircle
        aria-hidden="true"
        className="size-5 animate-spin text-info"
      />
    );
  return <Circle aria-hidden="true" className="size-5 text-muted" />;
}

function manualAction(type: string) {
  if (type === "b2_lifecycle")
    return "Revisa permisos de lifecycle del bucket y vuelve a verificar B2.";
  if (type === "b2_cors")
    return "Revisa permisos CORS del bucket y vuelve a verificar B2.";
  return "Aplica la configuración NodeProx indicada por el operador y vuelve a verificar.";
}

function ReadinessGroup({
  title,
  checks,
}: {
  title: string;
  checks: StorageReadinessCheck[];
}) {
  return (
    <section
      aria-label={title}
      className="min-w-0 space-y-3 rounded-control border border-border bg-surface-elevated/40 p-3"
    >
      <h4 className="m-0 font-medium">{title}</h4>
      {checks.length ? (
        <ul className="m-0 grid list-none gap-2 p-0 sm:grid-cols-2">
          {checks.map((check) => (
            <li
              key={check.type}
              className="flex min-w-0 items-start gap-2 rounded-control border border-border bg-surface p-3"
            >
              {statusIcon(check.status)}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">
                    {labels[check.type] ?? "Verificación del proveedor"}
                  </span>
                  <span
                    className={`text-sm ${check.status === "verified" ? "text-success" : check.status === "failed" ? "text-danger" : "text-muted"}`}
                  >
                    {statuses[check.status]}
                  </span>
                </div>
                <p className="mb-0 mt-1 text-xs text-muted">
                  {descriptions[check.type] ??
                    "Verificación de preparación del proveedor."}
                </p>
                {check.status === "manual_required" ? (
                  <p className="mb-0 mt-1 text-sm text-warning">
                    {storageProfileErrorMessage(check.lastErrorCode)}{" "}
                    {manualAction(check.type)}
                  </p>
                ) : null}
                {check.lastErrorCode ? (
                  <details className="mt-2 text-xs text-muted">
                    <summary className="w-fit cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                      Detalles técnicos
                    </summary>
                    <code className="mt-1 block break-all">
                      {check.lastErrorCode}
                    </code>
                  </details>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-sm text-muted">
          Aún no hay verificaciones registradas.
        </p>
      )}
    </section>
  );
}

export function StorageProfileReadiness({
  profile,
  readiness,
  busy,
  onAction,
  onRotate,
  onBrowserProbe,
}: {
  profile: StorageProfileDetail;
  readiness?: Readiness | undefined;
  busy: boolean;
  onAction: (
    action:
      | "b2/provision"
      | "b2/recheck"
      | "cloudflare/provision"
      | "cloudflare/recheck"
      | "activate",
  ) => Promise<void>;
  onRotate: (applicationKey: string) => Promise<void>;
  onBrowserProbe: () => Promise<void>;
}) {
  const [applicationKey, setApplicationKey] = useState("");
  const [rotationFeedback, setRotationFeedback] = useState("");
  const [rotationError, setRotationError] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [activationError, setActivationError] = useState("");
  const [operationFeedback, setOperationFeedback] = useState("");
  const [operationError, setOperationError] = useState("");
  const operational = readiness?.operationalMutationsEnabled === true;
  async function runOperation(
    action:
      | "b2/provision"
      | "b2/recheck"
      | "cloudflare/provision"
      | "cloudflare/recheck"
      | "activate",
  ) {
    setOperationFeedback("");
    setOperationError("");
    try {
      await onAction(action);
      setOperationFeedback(
        "Operación completada. Se actualizará el estado del perfil.",
      );
    } catch {
      setOperationError(
        "La operación no pudo completarse. Revisa el estado y vuelve a intentarlo.",
      );
      throw new Error("storage-profile-operation-failed");
    }
  }
  return (
    <Card className="space-y-5 p-5">
      <div>
        <h3 className="m-0 text-lg font-semibold">Preparación y activación</h3>
        {!operational ? (
          <p className="mb-0 mt-1 rounded-control bg-warning-soft p-3 text-sm text-warning">
            Las operaciones de proveedor y activación están deshabilitadas en
            este despliegue. La consulta de estado sigue disponible.
          </p>
        ) : null}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <ReadinessGroup
          title="Backblaze B2"
          checks={readiness?.b2.checks ?? []}
        />
        <ReadinessGroup
          title="Cloudflare"
          checks={readiness?.cloudflare.checks ?? []}
        />
      </div>
      {profile.source === "managed" ? (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!operational || busy}
            onClick={() =>
              void runOperation("b2/provision").catch(() => undefined)
            }
          >
            Aplicar y verificar B2
          </Button>
          <Button
            variant="secondary"
            disabled={!operational || busy}
            onClick={() =>
              void runOperation("b2/recheck").catch(() => undefined)
            }
          >
            Volver a verificar B2
          </Button>
          <Button
            variant="secondary"
            disabled={!operational || busy}
            onClick={() => {
              setOperationFeedback("");
              setOperationError("");
              void onBrowserProbe().then(
                () =>
                  setOperationFeedback(
                    "Carga directa del navegador verificada.",
                  ),
                () =>
                  setOperationError(
                    "El navegador no pudo completar la carga directa al bucket.",
                  ),
              );
            }}
          >
            Probar carga directa
          </Button>
        </div>
      ) : null}
      {profile.source === "env" && profile.status === "retired" ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="m-0 text-sm text-muted">
            Reactivar el perfil legacy solo cambia el destino del trabajo nuevo;
            las referencias históricas no se reescriben.
          </p>
          <Button
            disabled={
              !operational || readiness?.activation.eligible !== true || busy
            }
            onClick={() => {
              setActivationError("");
              setConfirmOpen(true);
            }}
          >
            Usar para cargas nuevas
          </Button>
          <ConfirmationDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Reactivar el perfil legacy"
            description="Este perfil se usará únicamente para trabajo nuevo. Los archivos existentes permanecen en su almacenamiento actual y no se moverán ni copiarán."
            confirmLabel="Usar para cargas nuevas"
            pending={busy}
            error={activationError || null}
            onConfirm={() => {
              void runOperation("activate")
                .then(() => setConfirmOpen(false))
                .catch(() =>
                  setActivationError(
                    "No se pudo activar el perfil. Vuelve a comprobar su preparación.",
                  ),
                );
            }}
          />
        </div>
      ) : null}
      {profile.source === "managed" ? (
        <div className="space-y-3 border-t border-border pt-4">
          <p className="m-0 text-sm text-muted">
            Estado de configuración:{" "}
            {cloudflareStatusLabels[
              readiness?.cloudflare.provisioningStatus ??
                profile.cloudflareProvisioningStatus
            ] ?? "Pendiente"}{" "}
            · {profile.publicHostname}
          </p>
          {readiness?.cloudflare.lastErrorCode ? (
            <details className="text-sm text-muted">
              <summary className="w-fit cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">
                Detalles técnicos
              </summary>
              <code className="mt-1 block break-all">
                {readiness.cloudflare.lastErrorCode}
              </code>
            </details>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={!operational || busy}
              onClick={() =>
                void runOperation("cloudflare/provision").catch(() => undefined)
              }
            >
              Configurar y verificar Cloudflare
            </Button>
            <Button
              variant="secondary"
              disabled={!operational || busy}
              onClick={() =>
                void runOperation("cloudflare/recheck").catch(() => undefined)
              }
            >
              Volver a verificar Cloudflare
            </Button>
          </div>
          <div className="space-y-2 rounded-control border border-border p-3">
            <p className="m-0 text-sm font-medium">Rotar credenciales B2</p>
            <p className="m-0 text-sm text-muted">
              La clave se valida y guarda cifrada; nunca se vuelve a mostrar.
            </p>
            <div className="flex flex-wrap gap-2">
              <input
                aria-label="Nueva Application Key secreta"
                type="password"
                autoComplete="new-password"
                value={applicationKey}
                disabled={!operational || busy}
                aria-describedby="storage-key-rotation-help"
                className="min-h-control min-w-64 flex-1 rounded-control border border-border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed disabled:opacity-60"
                onChange={(event) => setApplicationKey(event.target.value)}
              />
              <Button
                variant="secondary"
                disabled={
                  !operational ||
                  busy ||
                  applicationKey.length < 1 ||
                  applicationKey.length > 2048 ||
                  !profile.b2KeyId
                }
                loading={busy}
                onClick={async () => {
                  setRotationError("");
                  setRotationFeedback("");
                  try {
                    await onRotate(applicationKey);
                    setApplicationKey("");
                    setRotationFeedback(
                      "Credenciales rotadas. Vuelve a verificar B2.",
                    );
                  } catch {
                    setRotationError(
                      "No se pudieron validar o rotar las credenciales.",
                    );
                  }
                }}
              >
                Rotar credenciales
              </Button>
            </div>
            <p
              id="storage-key-rotation-help"
              className="m-0 text-xs text-muted"
            >
              La Application Key se envía al servidor para almacenarse cifrada.
            </p>
            {rotationFeedback ? (
              <p role="status" className="m-0 text-sm text-success">
                {rotationFeedback}
              </p>
            ) : null}
            {rotationError ? (
              <p role="alert" className="m-0 text-sm text-danger">
                {rotationError}
              </p>
            ) : null}
          </div>
          {readiness?.activation.blockingChecks.length ? (
            <p className="m-0 text-sm text-muted">
              Falta completar:{" "}
              {readiness.activation.blockingChecks
                .map((item) => labels[item] ?? "una verificación")
                .join(", ")}
              .
            </p>
          ) : null}
          <Button
            disabled={
              !operational || readiness?.activation.eligible !== true || busy
            }
            onClick={() => {
              setActivationError("");
              setConfirmOpen(true);
            }}
          >
            Usar para cargas nuevas
          </Button>
          <ConfirmationDialog
            open={confirmOpen}
            onOpenChange={setConfirmOpen}
            title="Usar este perfil para trabajo nuevo"
            description="Este perfil se usará únicamente para trabajo nuevo. Los archivos existentes permanecen en su almacenamiento actual y no se moverán ni copiarán."
            confirmLabel="Usar para cargas nuevas"
            pending={busy}
            error={activationError || null}
            onConfirm={() => {
              void runOperation("activate")
                .then(() => setConfirmOpen(false))
                .catch(() =>
                  setActivationError(
                    "No se pudo activar el perfil. Vuelve a comprobar su preparación.",
                  ),
                );
            }}
          />
        </div>
      ) : null}
      {profile.source === "env" ? (
        <p className="m-0 text-sm text-muted">
          Estado Cloudflare:{" "}
          {cloudflareStatusLabels[
            readiness?.cloudflare.provisioningStatus ??
              profile.cloudflareProvisioningStatus
          ] ?? "Pendiente"}{" "}
          · host público {profile.publicHostname}
        </p>
      ) : null}
      {operationFeedback ? (
        <p role="status" className="m-0 text-sm text-success">
          {operationFeedback}
        </p>
      ) : null}
      {operationError ? (
        <p role="alert" className="m-0 text-sm text-danger">
          {operationError}
        </p>
      ) : null}
    </Card>
  );
}
