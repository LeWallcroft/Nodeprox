"use client";

import { useEffect, useMemo, useState } from "react";
import { DiscordAuthorizationConfiguration } from "../../../../components/domains/discord/discord-authorization-configuration";
import { errorMessage } from "../../../../components/domains/feedback";
import { PageHeader } from "../../../../components/layout/page-header";
import { Button } from "../../../../components/ui/button";
import { Card } from "../../../../components/ui/card";
import { EmptyState } from "../../../../components/ui/empty-state";
import { ErrorState } from "../../../../components/ui/error-state";
import { LoadingState } from "../../../../components/ui/loading-state";
import { PageSection } from "../../../../components/ui/page-section";
import {
  useProductSettings,
  useUpdateProductSettings,
} from "../../../../lib/domains/settings/hooks";

export default function SettingsPage() {
  const settings = useProductSettings();
  const update = useUpdateProductSettings();
  const [values, setValues] = useState<Record<string, string>>({});
  const [success, setSuccess] = useState(false);
  useEffect(() => {
    if (!settings.data) return;
    setValues(
      Object.fromEntries(
        settings.data.sections.flatMap((section) =>
          section.fields.map((field) => [field.key, String(field.value)]),
        ),
      ),
    );
  }, [settings.data]);
  const changes = useMemo(
    () =>
      (settings.data?.sections ?? []).flatMap((section) =>
        section.fields.flatMap((field) => {
          const value = values[field.key];
          if (value === undefined || value === String(field.value)) return [];
          return [
            {
              key: field.key,
              value: field.type === "number" ? Number(value) : value,
            },
          ];
        }),
      ),
    [settings.data, values],
  );
  return (
    <>
      <PageHeader
        title="Configuración"
        description="Gestiona los ajustes operativos del producto."
        breadcrumbs={[
          { label: "Dashboard", href: "/" },
          { label: "Administración", href: "/admin" },
          { label: "Configuración", current: true },
        ]}
      />
      {settings.isPending ? (
        <LoadingState label="Cargando configuración" />
      ) : null}
      {settings.isError ? (
        <ErrorState
          title="No se pudo cargar la configuración"
          description={errorMessage(settings.error)}
          action={
            <Button onClick={() => void settings.refetch()}>Reintentar</Button>
          }
        />
      ) : null}
      {settings.data?.sections.length === 0 ? (
        <EmptyState
          title="No hay ajustes disponibles"
          description="No existen ajustes de producto disponibles para administrar."
        />
      ) : null}
      {settings.data?.sections.map((section) => (
        <PageSection key={section.id} title={section.label}>
          <Card className="space-y-5 p-5">
            {section.fields.map((field) => (
              <label key={field.key} className="block">
                <span className="text-sm font-medium text-primary">
                  {field.key === "upload_warning_image_size_mb"
                    ? "Peso de imagen para advertencia"
                    : field.label}
                </span>
                <span className="mt-1 block text-sm text-muted">
                  {field.key === "upload_warning_image_size_mb"
                    ? "Muestra un aviso cuando una imagen supere este tamaño. La carga continuará normalmente."
                    : field.description}
                </span>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    aria-label={field.label}
                    className="mt-3 w-full"
                    type={field.type === "number" ? "number" : "text"}
                    value={values[field.key] ?? ""}
                    min={field.constraints?.min}
                    max={field.constraints?.max}
                    disabled={!field.editable || update.isPending}
                    onChange={(event) => {
                      setSuccess(false);
                      setValues((current) => ({
                        ...current,
                        [field.key]: event.target.value,
                      }));
                    }}
                  />
                  <span className="text-sm text-muted">
                    {field.key === "upload_warning_image_size_mb"
                      ? "MB"
                      : field.key.includes("_px")
                        ? "px"
                        : "días"}
                  </span>
                </div>
              </label>
            ))}
          </Card>
        </PageSection>
      ))}
      {settings.data?.sections.length ? (
        <div className="mt-6 flex items-center gap-3">
          <Button
            disabled={
              !changes.length ||
              update.isPending ||
              changes.some((change) => Number.isNaN(change.value))
            }
            onClick={() =>
              update.mutate(changes, { onSuccess: () => setSuccess(true) })
            }
          >
            {update.isPending ? "Guardando…" : "Guardar cambios"}
          </Button>
          {success ? (
            <p className="text-sm text-success">
              Configuración actualizada correctamente.
            </p>
          ) : null}
          {update.isError ? (
            <p className="text-sm text-danger">{errorMessage(update.error)}</p>
          ) : null}
        </div>
      ) : null}
      <PageSection title="Integraciones">
        <DiscordAuthorizationConfiguration />
      </PageSection>
    </>
  );
}
