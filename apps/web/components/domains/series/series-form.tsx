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
import { Select } from "../../ui/select";
import { errorMessage } from "../feedback";

export function SeriesForm({
  initial,
  onSubmit,
  submitLabel = "Crear Series",
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
      <label
        className="grid gap-1.5 text-[13px] font-medium text-muted"
        htmlFor="series-title"
      >
        Título
        <input
          id="series-title"
          required
          maxLength={200}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
        />
        <span className="font-normal text-muted">
          El slug público se genera automáticamente y permanece estable.
        </span>
      </label>
      {requiresGrant ? (
        <label
          className="grid gap-1.5 text-[13px] font-medium text-muted"
          htmlFor="series-grant"
        >
          Autorización
          <Select
            id="series-grant"
            required
            value={grantId}
            onChange={(event) => setGrantId(event.target.value)}
          >
            <option disabled value="">
              Selecciona una autorización disponible
            </option>
            {availableGrants.map((grant) => (
              <option key={grant.id} value={grant.id}>
                {grantOptionLabel(grant)}
              </option>
            ))}
          </Select>
          <span className="font-normal text-muted">
            Esta autorización se consume al crear la Serie.
          </span>
        </label>
      ) : null}
      {requiresDiscordChannel ? (
        <label
          className="grid gap-1.5 text-[13px] font-medium text-muted"
          htmlFor="series-discord-channel"
        >
          Canal Discord *
          {channelsLoading ? (
            <span className="font-normal text-muted">
              Cargando canales de Discord…
            </span>
          ) : null}
          {channelsError ? (
            <div className="grid gap-1.5">
              <span className="font-normal text-danger">
                No se pudieron cargar los canales de Discord.
              </span>
              <Button
                type="button"
                variant="secondary"
                onClick={onRetryChannels}
              >
                Reintentar
              </Button>
            </div>
          ) : null}
          {!channelsLoading && !channelsError ? (
            <>
              <Select
                id="series-discord-channel"
                required
                disabled={selectableChannels.length === 0}
                value={discordChannelId}
                onChange={(event) => setDiscordChannelId(event.target.value)}
              >
                <option disabled value="">
                  {selectableChannels.length
                    ? "Selecciona un canal"
                    : "No hay canales Discord disponibles para vincular"}
                </option>
                {selectableChannels.map((channel) => (
                  <option key={channel.id} value={channel.id}>
                    #{channel.name}
                  </option>
                ))}
              </Select>
              {selectableChannels.length === 0 ? (
                <span className="font-normal text-muted">
                  No hay canales Discord disponibles para vincular.
                </span>
              ) : null}
            </>
          ) : null}
        </label>
      ) : null}
      <label
        className="grid gap-1.5 text-[13px] font-medium text-muted"
        htmlFor="series-cover-url"
      >
        Portada
        <input
          id="series-cover-url"
          type="url"
          maxLength={2048}
          placeholder="https://i.imgur.com/..."
          value={coverUrl ?? ""}
          onChange={(event) => setCoverUrl(event.target.value)}
        />
        <span className="font-normal text-muted">URL externa de portada</span>
      </label>
      <label
        className="grid gap-1.5 text-[13px] font-medium text-muted"
        htmlFor="series-description"
      >
        Descripción
        <textarea
          id="series-description"
          maxLength={5000}
          rows={4}
          value={description ?? ""}
          onChange={(event) => setDescription(event.target.value)}
        />
      </label>
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 max-[640px]:flex-col">
        <Button
          type="submit"
          disabled={
            loading ||
            (requiresDiscordChannel &&
              (channelsLoading || channelsError || !discordChannelId))
          }
        >
          {loading ? "Guardando…" : submitLabel}
        </Button>
        {onCancel ? (
          <button
            className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3.5 font-medium text-text"
            type="button"
            disabled={loading}
            onClick={onCancel}
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
