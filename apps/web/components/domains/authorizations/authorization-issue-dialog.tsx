"use client";

import { useState } from "react";
import { errorMessage } from "../feedback";
import {
  useAdminUserLookup,
  useDebouncedAuthorizationValue,
  useIssueSeriesCreationGrant,
} from "../../../lib/domains/authorizations/hooks";
import { Button } from "../../ui/button";
import { AppDialog } from "../../ui/app-dialog";
import { FieldShell } from "../../ui/field-shell";
import { SearchableCombobox } from "../../ui/searchable-combobox";

export function AuthorizationIssueDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [userSearch, setUserSearch] = useState("");
  const [targetUserId, setTargetUserId] = useState("");
  const [reference, setReference] = useState("");
  const search = useDebouncedAuthorizationValue(userSearch);
  const users = useAdminUserLookup(search, open);
  const issue = useIssueSeriesCreationGrant();
  const options = (users.data?.items ?? []).map((user) => ({
    id: user.id,
    label:
      user.displayName && user.email && user.displayName !== user.email
        ? `${user.displayName} — ${user.email}`
        : (user.displayName ?? user.email ?? "Usuario"),
  }));

  function close(nextOpen: boolean) {
    if (issue.isPending) return;
    if (!nextOpen) {
      setUserSearch("");
      setTargetUserId("");
      setReference("");
    }
    onOpenChange(nextOpen);
  }

  async function submit() {
    if (!targetUserId) return;
    await issue.mutateAsync({
      targetUserId,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
    });
    close(false);
  }

  return (
    <AppDialog
      busy={issue.isPending}
      description="Emite una autorización para que el usuario pueda crear una Serie."
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            onClick={() => close(false)}
          >
            Cancelar
          </Button>
          <Button
            disabled={!targetUserId}
            loading={issue.isPending}
            type="button"
            onClick={() => void submit()}
          >
            Crear autorización
          </Button>
        </div>
      }
      open={open}
      title="Nueva autorización"
      onOpenChange={close}
    >
      <div className="grid gap-4">
        <SearchableCombobox
          emptyMessage="No se encontraron usuarios."
          error={
            users.isError ? "No se pudieron cargar los usuarios." : undefined
          }
          id="authorization-target-user"
          label="Usuario"
          loading={users.isPending}
          options={options}
          placeholder="Buscar usuario…"
          required
          value={targetUserId}
          onChange={setTargetUserId}
          onRetry={() => void users.refetch()}
          onSearchChange={setUserSearch}
        />
        <FieldShell id="authorization-reference" label="Referencia">
          <input
            id="authorization-reference"
            maxLength={500}
            placeholder="Ej. campaña-2026"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        </FieldShell>
        {issue.isError ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {errorMessage(issue.error, "No se pudo crear la autorización.")}
          </p>
        ) : null}
      </div>
    </AppDialog>
  );
}
