import { Ban, Copy, Eye, History, Play } from "lucide-react";
import type {
  AdminSeriesCreationGrantListItem,
  SeriesCreationGrantListItem,
} from "../../../lib/domains/authorizations/types";
import {
  authorizationStatusLabel,
  authorizationStatusTone,
} from "../../../lib/domains/authorizations/view-model";
import { Button } from "../../ui/button";
import {
  DataTable,
  DataTableEmptyRow,
  getSelectableTableRowProps,
  stopTableRowSelection,
} from "../../ui/data-table";
import { StatusBadge } from "../../ui/status-badge";
import { TableRowActionMenu } from "../../ui/table-row-action-menu";

export function AuthorizationList({
  grants,
  selectedId,
  onSelect,
  onUse,
  onCopy,
  onHistory,
  onInvalidate,
  minTableHeightClassName,
}: {
  grants: readonly (
    | SeriesCreationGrantListItem
    | AdminSeriesCreationGrantListItem
  )[];
  selectedId?: string | null;
  onSelect?: ((grantId: string) => void) | undefined;
  onUse?: ((grant: SeriesCreationGrantListItem) => void) | undefined;
  onCopy?: ((displayCode: string) => void) | undefined;
  onHistory?: ((grantId: string) => void) | undefined;
  onInvalidate?:
    | ((
        grant: SeriesCreationGrantListItem | AdminSeriesCreationGrantListItem,
      ) => void)
    | undefined;
  minTableHeightClassName?: string | undefined;
}) {
  const showsTarget = grants.some((grant) => "targetUser" in grant);
  const showsActions = Boolean(
    onSelect || onCopy || onUse || onHistory || onInvalidate,
  );
  return (
    <DataTable
      fillRemainingSpace={Boolean(minTableHeightClassName)}
      label="Autorizaciones"
      {...(minTableHeightClassName
        ? { minHeightClassName: minTableHeightClassName }
        : {})}
    >
      <thead>
        <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted">
          <th className="px-4 py-3 font-medium">Código</th>
          <th className="px-4 py-3 font-medium">Referencia</th>
          <th className="px-4 py-3 font-medium">Estado</th>
          <th className="px-4 py-3 font-medium">Emitida</th>
          {showsTarget ? (
            <th className="px-4 py-3 font-medium">Usuario</th>
          ) : null}
          {showsActions ? (
            <th className="px-4 py-3 font-medium">Acciones</th>
          ) : null}
        </tr>
      </thead>
      <tbody>
        {grants.length === 0 ? (
          <DataTableEmptyRow
            colSpan={4 + Number(showsTarget) + Number(showsActions)}
            title="No se encontraron autorizaciones."
          />
        ) : (
          grants.map((grant, index) => {
            const selected = selectedId === grant.id;
            return (
              <tr
                {...(onSelect
                  ? getSelectableTableRowProps(() => onSelect(grant.id))
                  : {})}
                className={`h-[76px] ${onSelect ? "cursor-pointer" : ""} transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary ${index === grants.length - 1 ? "border-b-0" : "border-b border-border"} ${selected ? "bg-primary-soft" : onSelect ? "hover:bg-surface-elevated" : ""}`}
                key={grant.id}
              >
                <td className="px-4 py-3 align-middle font-mono text-sm text-text">
                  {grant.displayCode}
                </td>
                <td className="max-w-xs truncate px-4 py-3 align-middle text-sm text-muted">
                  {grant.reference ?? "Sin referencia"}
                </td>
                <td className="px-4 py-3 align-middle text-sm">
                  <StatusBadge
                    label={authorizationStatusLabel[grant.status]}
                    tone={authorizationStatusTone[grant.status]}
                  />
                </td>
                <td className="px-4 py-3 align-middle whitespace-nowrap text-sm text-muted">
                  {new Intl.DateTimeFormat("es", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(grant.issuedAt))}
                </td>
                {showsTarget ? (
                  <td className="max-w-48 truncate px-4 py-3 align-middle text-sm text-muted">
                    {"targetUser" in grant ? grant.targetUser.displayName : "—"}
                  </td>
                ) : null}
                {showsActions ? (
                  <td className="px-4 py-3 align-middle text-sm">
                    <div className="flex items-center justify-end gap-2">
                      {grant.status === "available" &&
                      grant.applicable &&
                      onUse ? (
                        <Button
                          aria-label={`Usar autorización ${grant.displayCode}`}
                          className="min-h-8 px-2 text-xs"
                          type="button"
                          onClick={(event) => {
                            stopTableRowSelection(event);
                            onUse(grant);
                          }}
                        >
                          Usar
                        </Button>
                      ) : null}
                      <TableRowActionMenu
                        label={`Acciones para ${grant.displayCode}`}
                        actions={[
                          ...(onSelect
                            ? [
                                {
                                  label: "Ver detalles",
                                  icon: (
                                    <Eye
                                      aria-hidden="true"
                                      className="size-4"
                                    />
                                  ),
                                  onSelect: () => onSelect(grant.id),
                                },
                              ]
                            : []),
                          ...(onCopy
                            ? [
                                {
                                  label: "Copiar código",
                                  icon: (
                                    <Copy
                                      aria-hidden="true"
                                      className="size-4"
                                    />
                                  ),
                                  onSelect: () => onCopy(grant.displayCode),
                                },
                              ]
                            : []),
                          ...(onHistory
                            ? [
                                {
                                  label: "Ver historial de uso",
                                  icon: (
                                    <History
                                      aria-hidden="true"
                                      className="size-4"
                                    />
                                  ),
                                  onSelect: () => onHistory(grant.id),
                                },
                              ]
                            : []),
                          ...(grant.status === "available" &&
                          grant.applicable &&
                          onUse
                            ? [
                                {
                                  label: "Usar autorización",
                                  icon: (
                                    <Play
                                      aria-hidden="true"
                                      className="size-4"
                                    />
                                  ),
                                  onSelect: () => onUse(grant),
                                },
                              ]
                            : []),
                          ...(onInvalidate && grant.status === "available"
                            ? [
                                {
                                  label: "Invalidar autorización",
                                  icon: (
                                    <Ban
                                      aria-hidden="true"
                                      className="size-4"
                                    />
                                  ),
                                  destructive: true,
                                  onSelect: () => onInvalidate(grant),
                                },
                              ]
                            : []),
                        ]}
                      />
                    </div>
                  </td>
                ) : null}
              </tr>
            );
          })
        )}
      </tbody>
    </DataTable>
  );
}
