"use client";

import { type FormEvent, useState } from "react";
import { ApiError } from "../../../lib/api/types";
import type { SeriesCreationGrantListItem } from "../../../lib/domains/authorizations/types";
import { grantOptionLabel } from "../../../lib/domains/authorizations/view-model";
import type {
  SelectableDiscordSeriesChannel,
  SeriesInput,
} from "../../../lib/domains/series/types";
import { Button } from "../../ui/button";
import { FieldShell, Textarea } from "../../ui/field-shell";
import { Input } from "../../ui/input";
import { SearchableCombobox } from "../../ui/searchable-combobox";
import { errorMessage } from "../feedback";

export function SeriesForm({
  initial,
  onSubmit,
  submitLabel = "Crear serie",
  onCancel,
  requiresGrant = false,
  availableGrants = [],
  requiresDiscordChannel = false,
  selectableChannels = [],
  channelsLoading = false,
  channelsError = false,
  onRetryChannels,
}: {
  initial?: Omit<Partial<SeriesInput>, "discordChannelId"> & {
    discordChannelId?: string | null;
  };
  onSubmit: (input: SeriesInput) => Promise<void>;
  submitLabel?: string;
  onCancel?: () => void;
  requiresGrant?: boolean;
  availableGrants?: readonly SeriesCreationGrantListItem[];
  requiresDiscordChannel?: boolean;
  selectableChannels?: readonly SelectableDiscordSeriesChannel[];
  channelsLoading?: boolean;
  channelsError?: boolean;
  onRetryChannels?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [coverUrl, setCoverUrl] = useState(initial?.coverUrl ?? "");
  const [grantId, setGrantId] = useState(initial?.grantId ?? "");
  const [discordChannelId, setDiscordChannelId] = useState(
    initial?.discordChannelId ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit({
        title: title.trim(),
        description: description.trim() || null,
        coverUrl: coverUrl.trim() || null,
        ...(requiresGrant ? { grantId } : {}),
        ...(requiresDiscordChannel ? { discordChannelId } : {}),
      });
    } catch (cause) {
      if (
        cause instanceof ApiError &&
        ["series-channel-invalid", "series-channel-already-bound"].includes(
          cause.code ?? "",
        )
      ) {
        setDiscordChannelId("");
        onRetryChannels?.();
      }
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="grid gap-3.5" onSubmit={handleSubmit}>
      <FieldShell
        id="series-title"
        label="Título"
        required
        description="El slug público se genera automáticamente y permanece estable."
      >
        <Input
          id="series-title"
          aria-describedby="series-title-description"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
      </FieldShell>
      {requiresGrant ? (
        <SearchableCombobox
          id="series-grant"
          label="Autorización"
          required
          value={grantId}
          onChange={setGrantId}
          options={availableGrants.map((grant) => ({
            id: grant.id,
            label: grantOptionLabel(grant),
          }))}
          placeholder="Buscar autorización disponible…"
          emptyMessage="No hay autorizaciones disponibles."
        />
      ) : null}
      {requiresDiscordChannel ? (
        <SearchableCombobox
          id="series-discord-channel"
          label="Canal Discord"
          required
          value={discordChannelId}
          onChange={setDiscordChannelId}
          options={selectableChannels.map((channel) => ({
            id: channel.id,
            label: `#${channel.name}`,
          }))}
          loading={channelsLoading}
          error={
            channelsError
              ? "No se pudieron cargar los canales de Discord."
              : undefined
          }
          onRetry={onRetryChannels}
          placeholder="Buscar canal…"
          emptyMessage="No hay canales Discord disponibles para vincular."
        />
      ) : null}
      <FieldShell
        id="series-cover-url"
        label="Portada"
        description="URL externa de portada"
      >
        <Input
          id="series-cover-url"
          aria-describedby="series-cover-url-description"
          type="url"
          maxLength={2048}
          placeholder="https://i.imgur.com/..."
          value={coverUrl ?? ""}
          onChange={(event) => setCoverUrl(event.target.value)}
        />
      </FieldShell>
      <FieldShell id="series-description" label="Descripción">
        <Textarea
          id="series-description"
          maxLength={5000}
          rows={4}
          value={description ?? ""}
          onChange={(event) => setDescription(event.target.value)}
        />
      </FieldShell>
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="sticky bottom-0 flex flex-row-reverse gap-2 border-t border-[var(--border-subtle)] bg-surface-elevated pt-4 max-[640px]:flex-col">
        <Button
          type="submit"
          disabled={
            loading ||
            (requiresGrant && !grantId) ||
            (requiresDiscordChannel &&
              (channelsLoading || channelsError || !discordChannelId))
          }
        >
          {loading ? "Guardando…" : submitLabel}
        </Button>
        {onCancel ? (
          <Button
            variant="secondary"
            type="button"
            disabled={loading}
            onClick={onCancel}
          >
            Cancelar
          </Button>
        ) : null}
      </div>
    </form>
  );
}
