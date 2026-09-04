"use client";

import { UserRoundPlus } from "lucide-react";
import { useState } from "react";
import {
  useGrantChapterHelper,
  useHelperCandidates,
} from "../../../lib/domains/chapters/hooks";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";

export function AssignChapterCollaboratorDialog({
  chapterId,
  chapterNumber,
  open,
  onClose,
}: {
  chapterId: string;
  chapterNumber: number;
  open: boolean;
  onClose: () => void;
}) {
  const [userId, setUserId] = useState("");
  const candidates = useHelperCandidates(chapterId, open);
  const grant = useGrantChapterHelper(chapterId);

  return (
    <AppDialog
      open={open}
      title="Asignar colaborador"
      description={`Capítulo ${chapterNumber}`}
      onOpenChange={(next) => {
        if (!next) {
          setUserId("");
          onClose();
        }
      }}
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            type="button"
            disabled={!userId || grant.isPending}
            onClick={() =>
              void grant.mutateAsync(userId).then(() => {
                setUserId("");
                onClose();
              })
            }
          >
            <UserRoundPlus aria-hidden="true" className="size-4" />
            {grant.isPending ? "Asignando…" : "Asignar"}
          </Button>
        </div>
      }
    >
      <label className="grid gap-1.5 text-sm font-medium text-secondary">
        Colaborador
        <select
          value={userId}
          disabled={candidates.isPending}
          onChange={(event) => setUserId(event.target.value)}
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
    </AppDialog>
  );
}
