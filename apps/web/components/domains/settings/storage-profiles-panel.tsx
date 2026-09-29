"use client";

import { Database, HardDrive, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiError } from "../../../lib/api/types";
import {
  useStorageProfile,
  useStorageProfileActions,
  useStorageProfiles,
  useStorageReadiness,
} from "../../../lib/domains/storage-profiles/hooks";
import { storageProfileErrorMessage } from "../../../lib/domains/storage-profiles/presentation";
import type { StorageProfileDraftInput } from "../../../lib/domains/storage-profiles/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { LoadingState } from "../../ui/loading-state";
import { StatusBadge } from "../../ui/status-badge";
import { StorageProfileCapabilities } from "./storage-profile-capabilities";
import { StorageProfileEditor } from "./storage-profile-editor";
import { StorageProfileReadiness } from "./storage-profile-readiness";

function errorCopy(error: unknown) {
  if (error instanceof ApiError && error.code)
    return storageProfileErrorMessage(error.code);
  return "La solicitud no pudo completarse. Inténtalo de nuevo.";
}

const statusLabels: Record<string, string> = {
  draft: "Borrador",
  ready: "Listo",
  active: "Activo",
  retired: "Retirado",
};

const statusTones = {
  draft: "warning",
  ready: "info",
  active: "success",
  retired: "neutral",
} as const;

export function toStorageProfileCreateInput(
  input: Partial<StorageProfileDraftInput>,
): StorageProfileDraftInput {
  if (
    input.name === undefined ||
    input.publicHostnameLabel === undefined ||
    input.b2Endpoint === undefined ||
    input.b2Region === undefined ||
    input.b2Bucket === undefined ||
    input.b2KeyId === undefined
  ) {
    throw new Error("El borrador del perfil está incompleto.");
  }

  return {
    name: input.name,
    publicHostnameLabel: input.publicHostnameLabel,
    b2Endpoint: input.b2Endpoint,
    b2Region: input.b2Region,
    b2Bucket: input.b2Bucket,
    b2KeyId: input.b2KeyId,
    ...(input.b2ApplicationKey === undefined
      ? {}
      : { b2ApplicationKey: input.b2ApplicationKey }),
  };
}

export function StorageProfilesPanel() {
  const list = useStorageProfiles();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [failure, setFailure] = useState("");
  const detail = useStorageProfile(selectedId);
  const readiness = useStorageReadiness(selectedId);
  const actions = useStorageProfileActions();
  const selected = detail.data;
  const busy =
    actions.create.isPending ||
    actions.update.isPending ||
    actions.rotate.isPending ||
    actions.operation.isPending ||
    actions.browserProbe.isPending;

  useEffect(() => {
    if (selectedId || creating || !list.data?.length) return;
    setSelectedId(
      list.data.find((profile) => profile.status === "active")?.id ??
        list.data[0]?.id ??
        null,
    );
  }, [creating, list.data, selectedId]);

  async function perform(
    id: string,
    action: Parameters<typeof actions.operation.mutateAsync>[0]["action"],
  ) {
    setFailure("");
    setFeedback("");
    try {
      await actions.operation.mutateAsync({ id, action });
      setFeedback("Operación completada. El estado se está actualizando.");
    } catch (error) {
      setFailure(errorCopy(error));
      throw error;
    }
  }

  async function save(input: Partial<StorageProfileDraftInput>) {
    setFailure("");
    if (selectedId) {
      await actions.update.mutateAsync({ id: selectedId, input });
    } else {
      const created = await actions.create.mutateAsync(
        toStorageProfileCreateInput(input),
      );
      setSelectedId(created.id);
      setCreating(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-control bg-primary-soft text-primary">
            <Database aria-hidden="true" className="size-5" />
          </span>
          <div className="min-w-0">
            <h2 className="m-0 text-xl font-semibold">Almacenamiento B2</h2>
            <p className="mb-0 mt-1 text-sm text-muted">
              Perfiles de Backblaze B2 y entrega mediante Cloudflare.
            </p>
          </div>
        </div>
        <div className="max-w-xl rounded-control border border-border bg-surface p-3 text-sm text-text-secondary">
          NodeProx registra un bucket B2 existente. No crea buckets
          automáticamente; el bucket debe prepararse antes de configurar el
          perfil.
        </div>
      </div>
      {list.isError ? (
        <p role="alert" className="text-danger">
          {errorCopy(list.error)}
        </p>
      ) : null}
      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(15rem,0.78fr)_minmax(0,1.8fr)]">
        <Card className="space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="m-0 font-semibold">Perfiles</h3>
            <Button
              size="sm"
              variant="secondary"
              icon={<Plus aria-hidden="true" className="size-4" />}
              onClick={() => {
                setCreating(true);
                setSelectedId(null);
                setFeedback("");
                setFailure("");
              }}
            >
              Crear perfil
            </Button>
          </div>
          {list.isPending ? <LoadingState label="Cargando perfiles" /> : null}
          <ul className="m-0 space-y-2 p-0">
            {list.data?.map((profile) => (
              <li key={profile.id}>
                <Button
                  variant={
                    selectedId === profile.id && !creating
                      ? "primary"
                      : "secondary"
                  }
                  className={`h-auto min-h-16 w-full justify-start border px-3 py-3 text-left ${selectedId === profile.id && !creating ? "border-primary bg-primary-soft/40" : "border-border bg-surface hover:bg-surface-elevated"}`}
                  aria-pressed={selectedId === profile.id && !creating}
                  onClick={() => {
                    setCreating(false);
                    setSelectedId(profile.id);
                    setFeedback("");
                    setFailure("");
                  }}
                >
                  <HardDrive
                    aria-hidden="true"
                    className="size-4 shrink-0 text-muted"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="block max-w-full truncate font-medium">
                        {profile.name}
                      </span>
                      <StatusBadge
                        label={statusLabels[profile.status] ?? profile.status}
                        tone={statusTones[profile.status] ?? "neutral"}
                      />
                    </span>
                    <span className="mt-1 block truncate text-xs text-muted">
                      {profile.publicHostname}
                    </span>
                  </span>
                </Button>
              </li>
            ))}
          </ul>
          {list.data?.length === 0 ? (
            <p className="m-0 rounded-control border border-dashed border-border p-4 text-sm text-muted">
              Aún no hay perfiles administrados. Crea un borrador para comenzar.
            </p>
          ) : null}
          {list.data?.find((profile) => profile.status === "active") ? (
            <div className="rounded-control border border-success/30 bg-success-soft/30 p-3">
              <div className="flex items-center gap-2">
                <StatusBadge label="Perfil activo" tone="success" />
              </div>
              <p className="mb-0 mt-2 text-sm font-medium text-text">
                {list.data.find((profile) => profile.status === "active")?.name}
              </p>
              <p className="mb-0 mt-1 break-all text-xs text-muted">
                {
                  list.data.find((profile) => profile.status === "active")
                    ?.publicHostname
                }
              </p>
            </div>
          ) : (
            <p className="m-0 rounded-control bg-warning-soft p-3 text-sm text-warning">
              No hay un perfil activo. Revisa la configuración del servidor.
            </p>
          )}
          <p className="m-0 text-xs leading-5 text-muted">
            Cambiar el perfil activo afecta solo a cargas nuevas. Los objetos
            existentes conservan su almacenamiento.
          </p>
        </Card>
        <div className="min-w-0 space-y-5">
          {creating ? (
            <StorageProfileEditor
              key="new-profile"
              profile={null}
              busy={busy}
              onSave={save}
            />
          ) : detail.isPending && selectedId ? (
            <LoadingState label="Cargando perfil" />
          ) : selected ? (
            <StorageProfileEditor
              key={selected.id}
              profile={selected}
              busy={busy}
              onSave={save}
            />
          ) : (
            <Card className="p-5 text-sm text-muted">
              Selecciona un perfil o crea un borrador administrado.
            </Card>
          )}
          {failure || feedback ? (
            <p
              role={failure ? "alert" : "status"}
              className={`m-0 text-sm ${failure ? "text-danger" : "text-success"}`}
            >
              {failure || feedback}
            </p>
          ) : null}
        </div>
      </div>
      {selected ? (
        <div className="grid gap-4 2xl:grid-cols-[minmax(0,1.8fr)_minmax(18rem,0.8fr)]">
          <StorageProfileReadiness
            key={`${selected.id}-readiness`}
            profile={selected}
            readiness={readiness.data}
            busy={busy}
            onAction={(action) => perform(selected.id, action)}
            onRotate={(b2ApplicationKey) =>
              actions.rotate
                .mutateAsync({
                  id: selected.id,
                  b2KeyId: selected.b2KeyId ?? "",
                  b2ApplicationKey,
                })
                .then(() => undefined)
            }
            onBrowserProbe={() =>
              actions.browserProbe
                .mutateAsync(selected.id)
                .then(() => undefined)
            }
          />
          <StorageProfileCapabilities
            profile={selected}
            readiness={readiness.data}
          />
        </div>
      ) : null}
    </div>
  );
}
