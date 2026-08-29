"use client";

import { useState, type FormEvent } from "react";
import { Button } from "../../ui/button";
import { errorMessage } from "../feedback";
import type { ChapterInput } from "../../../lib/domains/chapters/types";

export function ChapterForm({
  initial,
  onSubmit,
  submitLabel = "Crear Chapter",
  onCancel,
  editableNumber = true,
}: {
  initial?: Partial<ChapterInput>;
  onSubmit: (input: ChapterInput) => Promise<void>;
  submitLabel?: string;
  onCancel?: () => void;
  editableNumber?: boolean;
}) {
  const [chapterNumber, setChapterNumber] = useState(
    String(initial?.chapterNumber ?? ""),
  );
  const [title, setTitle] = useState(initial?.title ?? "");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await onSubmit({
        chapterNumber: Number(chapterNumber),
        title: title.trim() || null,
      });
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="grid gap-3.5" onSubmit={handleSubmit}>
      {editableNumber ? (
        <label
          className="grid gap-1.5 text-[13px] font-medium text-muted"
          htmlFor="chapter-number"
        >
          Número
          <input
            id="chapter-number"
            type="number"
            min={1}
            step={1}
            required
            value={chapterNumber}
            onChange={(event) => setChapterNumber(event.target.value)}
          />
        </label>
      ) : null}
      <label
        className="grid gap-1.5 text-[13px] font-medium text-muted"
        htmlFor="chapter-title"
      >
        Título
        <input
          id="chapter-title"
          maxLength={200}
          value={title ?? ""}
          onChange={(event) => setTitle(event.target.value)}
        />
      </label>
      {error ? (
        <p className="text-[13px] text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2 max-[640px]:flex-col">
        <Button type="submit" disabled={loading}>
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
