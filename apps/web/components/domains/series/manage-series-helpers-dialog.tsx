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
import { SearchableCombobox } from "../../ui/searchable-combobox";
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
      busy={grant.isPending || revoke.isPending}
      footer={
        <div className="flex justify-end">
          <Button
            variant="secondary"
            type="button"
            disabled={grant.isPending || revoke.isPending}
            onClick={onClose}
          >
            Cerrar
          </Button>
        </div>
      }
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
        <SearchableCombobox
          id="helper-chapter"
          label="Capítulo"
          value={chapterId}
          options={(chapters.data ?? []).map((chapter) => ({
            id: chapter.id,
            label: `Capítulo ${chapter.chapterNumber}${chapter.title ? ` — ${chapter.title}` : ""}`,
          }))}
          loading={chapters.isPending}
          error={
            chapters.isError
              ? "No se pudieron cargar los capítulos."
              : undefined
          }
          onRetry={() => void chapters.refetch()}
          onChange={(id) => {
            setChapterId(id);
            setUserId("");
          }}
        />
        {chapterId ? (
          <>
            <SearchableCombobox
              id="helper-user"
              label="Colaborador"
              value={userId}
              options={(candidates.data ?? []).map((candidate) => ({
                id: candidate.id,
                label: candidate.discordUsername
                  ? `${candidate.discordUsername} · ${candidate.email}`
                  : candidate.email,
              }))}
              loading={candidates.isPending}
              onChange={setUserId}
              error={
                candidates.isError
                  ? "No se pudieron cargar los candidatos."
                  : undefined
              }
              onRetry={() => void candidates.refetch()}
            />
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
