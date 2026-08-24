"use client";

import { useState, type FormEvent } from "react";
import { Button } from "../../ui/button";
import { errorMessage } from "../feedback";
import type { SeriesInput } from "../../../lib/domains/series/types";

export function SeriesForm({
  initial,
  onSubmit,
  submitLabel = "Crear Series",
  onCancel,
}: {
  initial?: Partial<SeriesInput>;
  onSubmit: (input: SeriesInput) => Promise<void>;
  submitLabel?: string;
  onCancel?: () => void;
}) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [slug, setSlug] = useState(initial?.slug ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit({
        title: title.trim(),
        slug: slug.trim(),
        description: description.trim() || null,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="grid gap-3.5" onSubmit={handleSubmit}>
      <label
        className="grid gap-1.5 text-[13px] font-bold text-muted"
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
      </label>
      <label
        className="grid gap-1.5 text-[13px] font-bold text-muted"
        htmlFor="series-slug"
      >
        Slug
        <input
          id="series-slug"
          required
          maxLength={220}
          value={slug}
          onChange={(event) => setSlug(event.target.value)}
        />
      </label>
      <label
        className="grid gap-1.5 text-[13px] font-bold text-muted"
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
        <p className="text-[13px] text-[#a52f2f]" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 max-[640px]:flex-col">
        <Button type="submit" disabled={loading}>
          {loading ? "Guardando…" : submitLabel}
        </Button>
        {onCancel ? (
          <button
            className="inline-flex min-h-control items-center justify-center rounded-lg border border-border bg-surface px-3.5 font-semibold text-text"
            type="button"
            onClick={onCancel}
          >
            Cancelar
          </button>
        ) : null}
      </div>
    </form>
  );
}
