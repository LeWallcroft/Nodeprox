"use client";

import { useMemo, useState } from "react";
import type {
  StorageProfileDetail,
  StorageProfileDraftInput,
} from "../../../lib/domains/storage-profiles/types";
import {
  type StorageProfileField,
  validateStorageProfileDraft,
  validateStorageProfileField,
} from "../../../lib/domains/storage-profiles/validation";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { FieldShell } from "../../ui/field-shell";
import { Input } from "../../ui/input";

const fields: Array<{
  key: StorageProfileField;
  label: string;
  help: string;
}> = [
  {
    key: "name",
    label: "Nombre del perfil",
    help: "Nombre interno visible a administradores.",
  },
  {
    key: "publicHostnameLabel",
    label: "Subdominio público",
    help: "Se publicará como https://{label}.nodeprox.org. media, www, api, app y admin están reservados.",
  },
  {
    key: "b2Endpoint",
    label: "Endpoint S3 de Backblaze",
    help: "Ejemplo: https://s3.<region>.backblazeb2.com",
  },
  {
    key: "b2Region",
    label: "Región",
    help: "Región configurada para el bucket B2.",
  },
  {
    key: "b2Bucket",
    label: "Nombre del bucket",
    help: "NodeProx registra un bucket B2 existente. No crea el bucket.",
  },
  {
    key: "b2KeyId",
    label: "Application Key ID",
    help: "Identificador de la Application Key administrada.",
  },
];

export function StorageProfileEditor({
  profile,
  busy,
  onSave,
}: {
  profile: StorageProfileDetail | null;
  busy: boolean;
  onSave: (input: Partial<StorageProfileDraftInput>) => Promise<void>;
}) {
  const [draft, setDraft] = useState<StorageProfileDraftInput>(() =>
    profile
      ? {
          name: profile.name,
          publicHostnameLabel: profile.publicHostnameLabel,
          b2Endpoint: profile.b2Endpoint,
          b2Region: profile.b2Region,
          b2Bucket: profile.b2Bucket,
          b2KeyId: profile.b2KeyId,
        }
      : {
          name: "",
          publicHostnameLabel: "",
          b2Endpoint: null,
          b2Region: null,
          b2Bucket: null,
          b2KeyId: null,
        },
  );
  const [applicationKey, setApplicationKey] = useState("");
  const [keyError, setKeyError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const nameEditable =
    profile?.source === "managed" && profile.status === "draft";
  const identityEditable =
    !profile ||
    (nameEditable && profile.cloudflareProvisioningStatus !== "verified");
  const errors = useMemo(() => {
    if (profile && !identityEditable) {
      const nameError = validateStorageProfileField("name", draft.name);
      return nameError ? { name: nameError } : {};
    }
    return validateStorageProfileDraft(draft);
  }, [draft, identityEditable, profile]);
  const visibleFields = fields;
  const labelError = errors.publicHostnameLabel;
  const canonicalLabel = draft.publicHostnameLabel.trim();
  const validLabel = !labelError && canonicalLabel.length > 0;

  function updateField(field: StorageProfileField, value: string) {
    setFeedback("");
    const nextValue =
      field === "publicHostnameLabel" ? value.toLowerCase() : value;
    setDraft((current) => ({
      ...current,
      [field]:
        field === "name" || field === "publicHostnameLabel"
          ? nextValue
          : nextValue || null,
    }));
  }

  if (profile?.source === "env") {
    return (
      <Card className="space-y-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="m-0 text-lg font-semibold">Perfil legacy</h3>
            <p className="mb-0 mt-1 text-sm text-muted">
              Esta configuración se administra en el entorno del servidor y no
              se puede editar desde la interfaz.
            </p>
          </div>
          <span className="rounded-full bg-surface-elevated px-2.5 py-1 text-xs font-medium text-muted">
            Legacy · solo lectura
          </span>
        </div>
        <dl className="grid gap-4 rounded-control border border-border bg-surface-elevated/40 p-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted">Nombre del perfil</dt>
            <dd className="mb-0 mt-1 font-medium text-text">{profile.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Proveedor</dt>
            <dd className="mb-0 mt-1 font-medium text-text">
              Backblaze B2 · configurado por environment
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-xs text-muted">Dominio público permanente</dt>
            <dd className="mb-0 mt-1 break-all font-medium text-text">
              https://{profile.publicHostname}
            </dd>
          </div>
        </dl>
        <p className="m-0 rounded-control bg-primary-soft/40 p-3 text-sm text-text-secondary">
          Las credenciales legacy se leen únicamente desde la configuración
          segura del servidor. No se guardan ni se muestran en esta pantalla.
          Los archivos existentes vinculados a este perfil mantienen su
          almacenamiento actual.
        </p>
      </Card>
    );
  }

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h3 className="m-0 text-lg font-semibold">
          {profile ? profile.name : "Nuevo perfil B2"}
        </h3>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {visibleFields.map((field) => {
          const id = `storage-profile-${field.key}`;
          const error = errors[field.key];
          const canEdit =
            !profile ||
            (nameEditable &&
              (field.key === "name" ||
                profile.cloudflareProvisioningStatus !== "verified"));
          const readOnly = Boolean(
            profile && !canEdit && profile.source === "managed",
          );
          const disabled = busy || !canEdit;
          const describedBy = [
            `${id}-description`,
            error ? `${id}-error` : null,
          ]
            .filter(Boolean)
            .join(" ");
          return (
            <FieldShell
              key={field.key}
              id={id}
              label={field.label}
              description={field.help}
              error={error}
              required
              disabled={disabled}
              readOnly={readOnly}
            >
              <Input
                id={id}
                value={draft[field.key] ?? ""}
                disabled={disabled}
                readOnly={readOnly}
                aria-invalid={error ? true : undefined}
                aria-describedby={describedBy}
                autoCapitalize="none"
                className={`min-h-control w-full rounded-control border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed ${error ? "border-danger" : "border-border"}`}
                onChange={(event) => updateField(field.key, event.target.value)}
              />
            </FieldShell>
          );
        })}
      </div>
      {draft.b2Endpoint && !draft.b2Endpoint.startsWith("https://") ? (
        <p className="m-0 rounded-control bg-warning-soft p-3 text-sm text-warning">
          Se recomienda HTTPS para proteger la conexión al endpoint.
        </p>
      ) : null}
      {!profile || identityEditable ? (
        <FieldShell
          id="storage-profile-application-key"
          label="Application Key secreta"
          description="Se envía al servidor para almacenarse cifrada. No volverá a mostrarse después de guardarla."
          error={keyError ?? undefined}
          disabled={busy || !identityEditable}
        >
          <Input
            id="storage-profile-application-key"
            type="password"
            autoComplete="new-password"
            value={applicationKey}
            disabled={busy || !identityEditable}
            aria-invalid={keyError ? true : undefined}
            aria-describedby={`storage-profile-application-key-description${keyError ? " storage-profile-application-key-error" : ""}`}
            className={`min-h-control w-full rounded-control border bg-surface px-3 text-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed ${keyError ? "border-danger" : "border-border"}`}
            onChange={(event) => {
              setApplicationKey(event.target.value);
              setKeyError(
                validateStorageProfileField(
                  "b2ApplicationKey",
                  event.target.value,
                ),
              );
            }}
          />
        </FieldShell>
      ) : null}
      <p className="m-0 text-sm text-muted">
        Vista previa:{" "}
        {validLabel
          ? `https://${canonicalLabel}.nodeprox.org`
          : "Introduce un subdominio válido."}
      </p>
      {profile?.source === "managed" ? (
        <p className="m-0 text-sm text-muted">
          Application Key{" "}
          {profile.credentialConfigured ? "configurada" : "pendiente"} · versión{" "}
          {profile.credentialVersion}. El secreto no se muestra.
        </p>
      ) : null}
      {!profile || nameEditable ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            disabled={
              busy || Object.keys(errors).length > 0 || Boolean(keyError)
            }
            loading={busy}
            onClick={async () => {
              setFeedback("");
              try {
                await onSave(
                  profile && !identityEditable
                    ? { name: draft.name }
                    : {
                        name: draft.name.trim(),
                        publicHostnameLabel: draft.publicHostnameLabel
                          .trim()
                          .toLowerCase(),
                        b2Endpoint: draft.b2Endpoint?.trim() || null,
                        b2Region: draft.b2Region?.trim() || null,
                        b2Bucket: draft.b2Bucket?.trim() || null,
                        b2KeyId: draft.b2KeyId?.trim() || null,
                        ...(applicationKey
                          ? { b2ApplicationKey: applicationKey }
                          : {}),
                      },
                );
                setApplicationKey("");
                setFeedback(profile ? "Borrador guardado." : "Perfil creado.");
              } catch {
                setFeedback(
                  "No se pudo guardar el perfil. Revisa los datos e inténtalo de nuevo.",
                );
              }
            }}
          >
            {profile ? "Guardar cambios" : "Crear perfil"}
          </Button>
          {feedback ? (
            <p role="status" className="m-0 text-sm text-success">
              {feedback}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="m-0 text-sm text-muted">
          La identidad del perfil no se puede cambiar en su estado actual. Usa
          la acción de rotación de credenciales cuando corresponda.
        </p>
      )}
    </Card>
  );
}
