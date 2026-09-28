"use client";

import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/api/types";
import {
  useStorageProfile,
  useStorageProfileActions,
  useStorageProfiles,
  useStorageReadiness,
} from "../../../lib/domains/storage-profiles/hooks";
import type {
  StorageProfileDraftInput,
  StorageReadinessCheck,
} from "../../../lib/domains/storage-profiles/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";

const emptyDraft: StorageProfileDraftInput = {
  name: "",
  publicHostnameLabel: "",
  b2Endpoint: null,
  b2Region: null,
  b2Bucket: null,
  b2KeyId: null,
};
const labels: Record<string, string> = {
  b2_credentials: "Credenciales",
  b2_bucket: "Bucket",
  b2_cors: "CORS",
  b2_lifecycle: "Lifecycle",
  b2_storage_probe: "Objeto de prueba",
  b2_browser_upload: "Carga directa desde navegador",
  cloudflare_dns: "DNS",
  cloudflare_transform: "Transform Rule",
  cloudflare_cache: "Cache Rule",
  cloudflare_delivery: "Entrega pública",
};
const statuses: Record<StorageReadinessCheck["status"], string> = {
  pending: "Pendiente",
  checking: "Comprobando",
  verified: "Verificado",
  manual_required: "Acción manual requerida",
  failed: "Falló",
};

function message(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "storage-managed-operations-disabled")
      return "Las operaciones de almacenamiento administrado están deshabilitadas en este despliegue.";
    if (error.code === "storage-profile-activation-conflict")
      return "El perfil cambió; vuelve a comprobar su preparación antes de activarlo.";
    if (error.code === "storage-profile-cipher-unavailable")
      return "El cifrado de credenciales no está disponible.";
    if (error.code === "storage-profile-conflict")
      return "La configuración del perfil entra en conflicto con su estado actual.";
    if (error.code?.startsWith("B2_")) return `B2: ${error.code}`;
    if (error.code?.startsWith("CLOUDFLARE_"))
      return `Cloudflare: ${error.code}`;
  }
  return error instanceof Error
    ? error.message
    : "La operación no pudo completarse.";
}

function CheckList({ checks }: { checks: StorageReadinessCheck[] }) {
  return (
    <ul className="space-y-1 text-sm">
      {checks.map((check) => (
        <li key={check.type} className="flex flex-wrap gap-2">
          <span>{labels[check.type] ?? check.type}:</span>
          <span
            className={
              check.status === "verified"
                ? "text-success"
                : check.status === "failed"
                  ? "text-danger"
                  : "text-muted"
            }
          >
            {statuses[check.status]}
          </span>
          {check.lastErrorCode ? (
            <span className="text-danger">{check.lastErrorCode}</span>
          ) : null}
          {check.status === "manual_required" ? (
            <pre className="w-full overflow-auto whitespace-pre-wrap text-muted">
              {String(
                check.metadata.desiredCorsConfiguration ??
                  check.metadata.desiredLifecycleConfiguration ??
                  "Aplica manualmente la configuración NodeProx y vuelve a comprobar.",
              )}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function StorageProfilesPanel() {
  const list = useStorageProfiles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<StorageProfileDraftInput>(emptyDraft);
  const [rotateKey, setRotateKey] = useState("");
  const [feedback, setFeedback] = useState("");
  const detail = useStorageProfile(selectedId);
  const readiness = useStorageReadiness(selectedId);
  const actions = useStorageProfileActions();
  const selected = detail.data;
  const active = list.data?.find((profile) => profile.status === "active");
  const busy =
    actions.create.isPending ||
    actions.update.isPending ||
    actions.rotate.isPending ||
    actions.operation.isPending ||
    actions.browserProbe.isPending;
  const operational = readiness.data?.operationalMutationsEnabled === true;
  const editable =
    !selected || (selected.source === "managed" && selected.status === "draft");
  const label = draft.publicHostnameLabel.trim().toLowerCase();
  const validLabel =
    /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label) &&
    !["media", "www", "api", "app", "admin"].includes(label);

  useEffect(() => {
    if (!selected) return;
    setDraft({
      name: selected.name,
      publicHostnameLabel: selected.publicHostnameLabel,
      b2Endpoint: selected.b2Endpoint,
      b2Region: selected.b2Region,
      b2Bucket: selected.b2Bucket,
      b2KeyId: selected.b2KeyId,
    });
    setRotateKey("");
  }, [selected]);

  async function perform(
    action: Parameters<typeof actions.operation.mutateAsync>[0]["action"],
  ) {
    if (!selectedId) return;
    setFeedback("");
    try {
      await actions.operation.mutateAsync({ id: selectedId, action });
      setFeedback("Operación completada.");
    } catch (error) {
      setFeedback(message(error));
    }
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-2 p-5">
        <h3 className="font-semibold">Perfil activo</h3>
        <p>
          {active
            ? `${active.name} · ${active.publicHostname}`
            : "No hay perfil activo. Revisa la configuración del servidor."}
        </p>
        <p className="text-sm text-muted">
          Los objetos existentes permanecen vinculados al perfil con el que se
          crearon.
        </p>
      </Card>
      {list.isError ? (
        <p role="alert" className="text-danger">
          {message(list.error)}
        </p>
      ) : null}
      <div className="grid gap-5 lg:grid-cols-[minmax(14rem,1fr)_minmax(0,2fr)]">
        <Card className="space-y-3 p-5">
          <h3 className="font-semibold">Perfiles</h3>
          <ul className="space-y-2">
            {list.data?.map((profile) => (
              <li key={profile.id}>
                <Button
                  variant={selectedId === profile.id ? "primary" : "secondary"}
                  className="w-full justify-start"
                  onClick={() => {
                    setSelectedId(profile.id);
                    setFeedback("");
                  }}
                >
                  {profile.name} · {profile.status}
                </Button>
              </li>
            ))}
          </ul>
          <Button
            variant="secondary"
            onClick={() => {
              setSelectedId(null);
              setDraft(emptyDraft);
              setFeedback("");
            }}
          >
            Crear perfil administrado
          </Button>
        </Card>
        <div className="space-y-5">
          <Card className="space-y-4 p-5">
            <h3 className="font-semibold">
              {selected ? selected.name : "Nuevo perfil B2"}
            </h3>
            {selected?.source === "env" ? (
              <p className="text-sm text-muted">
                Perfil legacy · credenciales respaldadas por el entorno ·{" "}
                {selected.publicHostname}. Solo lectura.
              </p>
            ) : null}
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  "name",
                  "publicHostnameLabel",
                  "b2Endpoint",
                  "b2Region",
                  "b2Bucket",
                  "b2KeyId",
                ] as const
              ).map((field) => (
                <label key={field} className="block text-sm">
                  <span className="font-medium">
                    {
                      {
                        name: "Nombre",
                        publicHostnameLabel: "Etiqueta pública",
                        b2Endpoint: "Endpoint B2",
                        b2Region: "Región B2",
                        b2Bucket: "Bucket B2",
                        b2KeyId: "Key ID B2",
                      }[field]
                    }
                  </span>
                  <input
                    className="mt-1 w-full rounded-control border p-2"
                    value={draft[field] ?? ""}
                    disabled={
                      !editable ||
                      busy ||
                      (Boolean(
                        selected?.cloudflareProvisioningStatus === "verified",
                      ) &&
                        field !== "name")
                    }
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        [field]:
                          event.target.value ||
                          (field === "name" || field === "publicHostnameLabel"
                            ? ""
                            : null),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <p className="text-sm text-muted">
              Vista previa:{" "}
              {validLabel
                ? `https://${label}.nodeprox.org`
                : "Introduce una etiqueta válida (1–63 caracteres, letras minúsculas, números y guiones)."}
            </p>
            {editable &&
            selected?.cloudflareProvisioningStatus !== "verified" ? (
              <>
                <label className="block text-sm">
                  <span className="font-medium">
                    Application Key B2 {selected ? "(rotación opcional)" : ""}
                  </span>
                  <input
                    type="password"
                    autoComplete="new-password"
                    className="mt-1 w-full rounded-control border p-2"
                    value={rotateKey}
                    onChange={(event) => setRotateKey(event.target.value)}
                  />
                </label>
                <Button
                  loading={busy}
                  disabled={!draft.name.trim() || !validLabel}
                  onClick={async () => {
                    try {
                      if (selectedId)
                        await actions.update.mutateAsync({
                          id: selectedId,
                          input: {
                            ...draft,
                            ...(rotateKey
                              ? { b2ApplicationKey: rotateKey }
                              : {}),
                          },
                        });
                      else {
                        const created = await actions.create.mutateAsync({
                          ...draft,
                          ...(rotateKey ? { b2ApplicationKey: rotateKey } : {}),
                        });
                        setSelectedId(created.id);
                      }
                      setRotateKey("");
                      setFeedback("Borrador guardado.");
                    } catch (error) {
                      setFeedback(message(error));
                    }
                  }}
                >
                  {selected ? "Guardar borrador" : "Crear borrador"}
                </Button>
              </>
            ) : null}
            {selected?.source === "managed" ? (
              <p className="text-sm text-muted">
                Credenciales:{" "}
                {selected.credentialConfigured ? "configuradas" : "pendientes"}{" "}
                · versión {selected.credentialVersion}. La clave nunca se
                muestra después de guardarla.
              </p>
            ) : null}
          </Card>
          {selected?.source === "managed" ? (
            <Card className="space-y-4 p-5">
              <h3 className="font-semibold">Preparación y activación</h3>
              {!operational ? (
                <p className="text-sm text-muted">
                  Las operaciones de proveedor y activación están deshabilitadas
                  en este despliegue. Puedes preparar el borrador.
                </p>
              ) : null}
              <h4 className="font-medium">B2</h4>
              <CheckList checks={readiness.data?.b2.checks ?? []} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={!operational || busy}
                  onClick={() => void perform("b2/provision")}
                >
                  Configurar B2
                </Button>
                <Button
                  variant="secondary"
                  disabled={!operational || busy}
                  onClick={() => void perform("b2/recheck")}
                >
                  Recomprobar B2
                </Button>
                <Button
                  variant="secondary"
                  disabled={!operational || busy}
                  onClick={async () => {
                    if (!selectedId) return;
                    try {
                      await actions.browserProbe.mutateAsync(selectedId);
                      setFeedback("Carga directa del navegador verificada.");
                    } catch (error) {
                      setFeedback(message(error));
                    }
                  }}
                >
                  Probar carga desde navegador
                </Button>
              </div>
              {selected.credentialConfigured ? (
                <div className="flex flex-wrap gap-2">
                  <input
                    aria-label="Nueva Application Key B2"
                    type="password"
                    autoComplete="new-password"
                    className="rounded-control border p-2"
                    value={rotateKey}
                    onChange={(event) => setRotateKey(event.target.value)}
                  />
                  <Button
                    variant="secondary"
                    disabled={
                      !operational || busy || !rotateKey || !draft.b2KeyId
                    }
                    onClick={async () => {
                      try {
                        await actions.rotate.mutateAsync({
                          id: selected.id,
                          b2KeyId: draft.b2KeyId as string,
                          b2ApplicationKey: rotateKey,
                        });
                        setRotateKey("");
                        setFeedback(
                          "Credenciales rotadas; vuelve a comprobar B2.",
                        );
                      } catch (error) {
                        setFeedback(message(error));
                      }
                    }}
                  >
                    Rotar credenciales
                  </Button>
                </div>
              ) : null}
              <h4 className="font-medium">
                Cloudflare · {selected.publicHostname}
              </h4>
              <p className="text-sm text-muted">
                Estado:{" "}
                {readiness.data?.cloudflare.provisioningStatus ??
                  selected.cloudflareProvisioningStatus}
                {readiness.data?.cloudflare.lastErrorCode
                  ? ` · ${readiness.data.cloudflare.lastErrorCode}`
                  : ""}
              </p>
              <CheckList checks={readiness.data?.cloudflare.checks ?? []} />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={!operational || busy}
                  onClick={() => void perform("cloudflare/provision")}
                >
                  Provisionar Cloudflare
                </Button>
                <Button
                  variant="secondary"
                  disabled={!operational || busy}
                  onClick={() => void perform("cloudflare/recheck")}
                >
                  Recomprobar Cloudflare
                </Button>
              </div>
              <p className="text-sm text-muted">
                Bloqueos:{" "}
                {readiness.data?.activation.blockingChecks.join(", ") ||
                  "ninguno"}
              </p>
              <Button
                disabled={
                  !operational || !readiness.data?.activation.eligible || busy
                }
                onClick={() => {
                  if (
                    window.confirm(
                      "Esto cambia el almacenamiento solo para trabajo nuevo. Las cargas e imágenes existentes permanecen en su perfil actual; no se moverá media.",
                    )
                  )
                    void perform("activate");
                }}
              >
                Activar perfil
              </Button>
            </Card>
          ) : selected?.source === "env" && selected.status === "retired" ? (
            <Card className="space-y-3 p-5">
              <p>
                Reactivar el perfil legacy cambia solo el destino del trabajo
                nuevo.
              </p>
              <Button
                disabled={!operational || busy}
                onClick={() => {
                  if (
                    window.confirm(
                      "¿Reactivar legacy para trabajo nuevo? No se moverán objetos existentes.",
                    )
                  )
                    void perform("activate");
                }}
              >
                Reactivar legacy
              </Button>
            </Card>
          ) : null}
        </div>
      </div>
      {feedback ? (
        <p role="status" className="text-sm">
          {feedback}
        </p>
      ) : null}
    </div>
  );
}
