import type {
  AdminSeriesCreationGrantListItem,
  SeriesCreationGrantListItem,
} from "../../../lib/domains/authorizations/types";
import { authorizationStatusLabel } from "../../../lib/domains/authorizations/view-model";
import { Button } from "../../ui/button";
import { DataTable, DataTableEmptyRow } from "../../ui/data-table";

export function AuthorizationList({
  grants,
  onUse,
}: {
  grants: readonly (
    | SeriesCreationGrantListItem
    | AdminSeriesCreationGrantListItem
  )[];
  onUse?: (grant: SeriesCreationGrantListItem) => void;
}) {
  const showsTarget = grants.some((grant) => "targetUser" in grant);
  const showsActions = !showsTarget && Boolean(onUse);
  return (
    <DataTable label="Autorizaciones">
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
          grants.map((grant) => (
            <tr
              className="border-b border-border last:border-b-0"
              key={grant.id}
            >
              <td className="px-4 py-3 font-mono text-sm text-text">
                {grant.displayCode}
              </td>
              <td className="max-w-xs truncate px-4 py-3 text-sm text-muted">
                {grant.reference ?? "Sin referencia"}
              </td>
              <td className="px-4 py-3 text-sm">
                <span
                  className={
                    grant.status === "available"
                      ? "rounded-full bg-success-soft px-2 py-1 text-xs font-medium text-success"
                      : "rounded-full bg-surface-elevated px-2 py-1 text-xs font-medium text-muted"
                  }
                >
                  {authorizationStatusLabel[grant.status]}
                </span>
              </td>
              <td className="px-4 py-3 text-sm text-muted">
                {new Intl.DateTimeFormat("es", {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(grant.issuedAt))}
              </td>
              {showsTarget ? (
                <td className="px-4 py-3 text-sm text-muted">
                  {"targetUser" in grant ? grant.targetUser.displayName : "—"}
                </td>
              ) : null}
              {showsActions ? (
                <td className="px-4 py-3 text-sm">
                  {grant.status === "available" && grant.applicable ? (
                    <Button
                      aria-label={`Usar autorización ${grant.displayCode}`}
                      className="min-h-8 px-2 text-xs"
                      type="button"
                      onClick={() => onUse?.(grant)}
                    >
                      Usar
                    </Button>
                  ) : grant.status === "available" ? (
                    <span className="text-xs text-muted">
                      No requerido con tu rol actual
                    </span>
                  ) : null}
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
    </DataTable>
  );
}
