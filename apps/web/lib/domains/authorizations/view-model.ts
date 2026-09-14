import type {
  SeriesCreationGrantListItem,
  SeriesCreationGrantStatus,
} from "./types";

export const authorizationStatusLabel: Record<
  SeriesCreationGrantStatus,
  string
> = {
  available: "Disponible",
  reserved: "Reservada",
  consumed: "Consumida",
  invalidated: "Invalidada",
};

export function grantOptionLabel(grant: SeriesCreationGrantListItem): string {
  return grant.reference
    ? `${grant.displayCode} — ${grant.reference}`
    : grant.displayCode;
}
