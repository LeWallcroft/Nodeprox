"use client";

import { UserRoundPlus } from "lucide-react";
import { useState } from "react";
import {
  useGrantChapterHelper,
  useHelperCandidates,
} from "../../../lib/domains/chapters/hooks";
import { AppDialog } from "../../ui/app-dialog";
import { Button } from "../../ui/button";
import { SearchableCombobox } from "../../ui/searchable-combobox";

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
      <SearchableCombobox
        id="chapter-collaborator"
        label="Colaborador"
        value={userId}
        disabled={candidates.isPending}
        loading={candidates.isPending}
        error={
          candidates.isError
            ? "No se pudieron cargar los candidatos."
            : undefined
        }
        onRetry={() => void candidates.refetch()}
        placeholder="Buscar colaborador…"
        emptyMessage="No hay colaboradores disponibles."
        options={(candidates.data ?? []).map((candidate) => ({
          id: candidate.id,
          label: candidate.discordUsername
            ? `${candidate.discordUsername} · ${candidate.email}`
            : candidate.email,
        }))}
        onChange={setUserId}
      />
    </AppDialog>
  );
}
