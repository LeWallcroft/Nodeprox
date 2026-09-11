"use client";

import { Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  useDiscordAuthorizationConfiguration,
  useReplaceDiscordAuthorizationConfiguration,
} from "../../../lib/domains/discord-configuration/hooks";
import { normalizeDiscordAuthorizedRoles } from "../../../lib/domains/discord-configuration/normalize";
import {
  type DiscordAuthorizedRole,
  type DiscordCapability,
  discordCapabilities,
} from "../../../lib/domains/discord-configuration/types";
import { Button } from "../../ui/button";
import { Card } from "../../ui/card";
import { ErrorState } from "../../ui/error-state";
import { LoadingState } from "../../ui/loading-state";
import { errorMessage } from "../feedback";

const labels: Record<DiscordCapability, string> = {
  "series_grant.issue": "Autorizar Series",
  "series_grant.invalidate": "Invalidar autorizaciones",
  "bot.configure": "Administrar bot",
};

export function DiscordAuthorizationConfiguration() {
  const configuration = useDiscordAuthorizationConfiguration();
  const update = useReplaceDiscordAuthorizationConfiguration();
  const [roles, setRoles] = useState<DiscordAuthorizedRole[]>([]);

  useEffect(() => {
    if (configuration.data) setRoles(configuration.data.roles);
  }, [configuration.data]);

  const canSave = useMemo(
    () =>
      roles.length > 0 &&
      roles.some((role) => role.capabilities.includes("bot.configure")) &&
      roles.every((role) => /^\d{17,20}$/.test(role.roleId.trim())),
    [roles],
  );

  if (configuration.isPending) {
    return <LoadingState label="Cargando integración Discord" />;
  }
  if (configuration.isError)
    return (
      <ErrorState
        title="No se pudo cargar la integración Discord"
        description={errorMessage(configuration.error)}
        action={
          <Button onClick={() => void configuration.refetch()}>
            Reintentar
          </Button>
        }
      />
    );

  return (
    <Card className="space-y-5 p-5">
      <div>
        <h2 className="text-base font-semibold text-primary">
          Integración Discord
        </h2>
        <p className="mt-1 text-sm text-muted">
          Define explícitamente qué roles Discord pueden emitir, invalidar o
          administrar autorizaciones.
        </p>
      </div>
      <div className="space-y-3">
        {roles.map((role, index) => (
          <div
            key={role.roleId}
            className="rounded-control border border-border p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <label className="text-sm font-medium text-primary">
                Role ID
                <input
                  aria-label={`Role ID ${role.roleId}`}
                  className="mt-2 block w-full rounded-control border border-border bg-surface px-3 py-2 text-sm"
                  value={role.roleId}
                  onChange={(event) =>
                    setRoles((current) =>
                      current.map((value, currentIndex) =>
                        currentIndex === index
                          ? { ...value, roleId: event.target.value }
                          : value,
                      ),
                    )
                  }
                />
              </label>
              <Button
                aria-label={`Eliminar rol ${role.roleId}`}
                variant="destructive"
                type="button"
                onClick={() =>
                  setRoles((current) =>
                    current.filter((_, currentIndex) => currentIndex !== index),
                  )
                }
              >
                <Trash2 size={16} />
              </Button>
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-3">
              {discordCapabilities.map((capability) => (
                <label
                  key={capability}
                  className="flex items-center gap-2 text-sm text-text"
                >
                  <input
                    type="checkbox"
                    checked={role.capabilities.includes(capability)}
                    onChange={() =>
                      setRoles((current) =>
                        current.map((value, currentIndex) =>
                          currentIndex !== index
                            ? value
                            : {
                                ...value,
                                capabilities: value.capabilities.includes(
                                  capability,
                                )
                                  ? value.capabilities.filter(
                                      (item) => item !== capability,
                                    )
                                  : [...value.capabilities, capability],
                              },
                        ),
                      )
                    }
                  />
                  {labels[capability]}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        disabled={roles.some((role) => !role.roleId.trim())}
        onClick={() =>
          setRoles((current) => [...current, { roleId: "", capabilities: [] }])
        }
      >
        <Plus size={16} /> Añadir rol
      </Button>
      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
        <Button
          type="button"
          disabled={!canSave || update.isPending}
          onClick={() => update.mutate(normalizeDiscordAuthorizedRoles(roles))}
        >
          <Save size={16} />{" "}
          {update.isPending ? "Guardando…" : "Guardar roles Discord"}
        </Button>
        {!canSave ? (
          <p className="text-sm text-muted">
            Debe permanecer al menos un rol con “Administrar bot”.
          </p>
        ) : null}
        {update.isError ? (
          <p className="text-sm text-danger">{errorMessage(update.error)}</p>
        ) : null}
        {update.isSuccess ? (
          <p className="text-sm text-success">
            Configuración Discord actualizada.
          </p>
        ) : null}
      </div>
    </Card>
  );
}
