"use client";

import { useState } from "react";
import { UserMinus, UserPlus } from "lucide-react";
import { errorMessage } from "../feedback";
import {
  useChapterList,
  useChapterHelpers,
  useGrantChapterHelper,
  useHelperCandidates,
  useRevokeChapterHelper,
} from "../../../lib/domains/chapters/hooks";
import type { Series } from "../../../lib/domains/series/types";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";

export function ManageSeriesHelpersDialog({
  open,
  onClose,
  series,
}: {
  open: boolean;
  onClose: () => void;
  series: Series;
}) {
  const chapters = useChapterList(series.id);
  const [chapterId, setChapterId] = useState("");
  const [userId, setUserId] = useState("");
  const helpers = useChapterHelpers(chapterId, open);
  const candidates = useHelperCandidates(chapterId, open);
  const grant = useGrantChapterHelper(chapterId);
  const revoke = useRevokeChapterHelper(chapterId);
  const selectedChapter = chapters.data?.find(
    (chapter) => chapter.id === chapterId,
  );
  const issue =
    grant.error ?? revoke.error ?? helpers.error ?? candidates.error;

  return (
    <AppDialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setChapterId("");
          setUserId("");
          onClose();
        }
      }}
      title="Gestionar colaboradores"
      description={`Serie: ${series.title}`}
    >
      <div className="grid gap-4">
        <label className="grid gap-1.5 text-sm font-medium text-secondary">
          Capítulo
          <select
            value={chapterId}
            onChange={(event) => {
              setChapterId(event.target.value);
              setUserId("");
            }}
          >
            <option value="">Selecciona un capítulo</option>
            {(chapters.data ?? []).map((chapter) => (
              <option key={chapter.id} value={chapter.id}>
                Capítulo {chapter.chapterNumber}
                {chapter.title ? ` — ${chapter.title}` : ""}
              </option>
            ))}
          </select>
        </label>
        {chapterId ? (
          <>
            <label className="grid gap-1.5 text-sm font-medium text-secondary">
              Colaborador
              <select
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
                disabled={candidates.isPending}
              >
                <option value="">
                  {candidates.isPending
                    ? "Cargando candidatos…"
                    : "Selecciona un colaborador"}
                </option>
                {(candidates.data ?? []).map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.discordUsername
                      ? `${candidate.discordUsername} · ${candidate.email}`
                      : candidate.email}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              disabled={!userId || grant.isPending}
              onClick={() =>
                void grant.mutateAsync(userId).then(() => setUserId(""))
              }
            >
              <UserPlus aria-hidden="true" className="size-4" />{" "}
              {grant.isPending ? "Añadiendo…" : "Añadir colaborador"}
            </Button>
            <div className="border-t border-border pt-4">
              <h3 className="m-0 text-base font-semibold">
                Colaboradores actuales
                {selectedChapter
                  ? ` · Capítulo ${selectedChapter.chapterNumber}`
                  : ""}
              </h3>
              {helpers.isPending ? (
                <p className="text-sm text-muted">Cargando colaboradores…</p>
              ) : null}
              {helpers.data?.length === 0 ? (
                <p className="text-sm text-muted">
                  No hay colaboradores activos para este capítulo.
                </p>
              ) : null}
              <ul className="m-0 grid list-none gap-2 p-0">
                {(helpers.data ?? []).map((helper) => (
                  <li
                    key={helper.userId}
                    className="flex items-center justify-between gap-3 rounded-control border border-border bg-surface p-3 text-sm"
                  >
                    <span className="min-w-0 truncate">
                      {helper.discordUsername
                        ? `${helper.discordUsername} · ${helper.email}`
                        : helper.email}
                    </span>
                    <Button
                      variant="destructive"
                      type="button"
                      disabled={revoke.isPending}
                      onClick={() => void revoke.mutateAsync(helper.userId)}
                    >
                      <UserMinus aria-hidden="true" className="size-4" />{" "}
                      Revocar
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        ) : null}
        {issue ? (
          <p role="alert" className="m-0 text-sm text-danger">
            {errorMessage(issue)}
          </p>
        ) : null}
      </div>
    </AppDialog>
  );
}
