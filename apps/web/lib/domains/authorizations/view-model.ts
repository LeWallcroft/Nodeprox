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

export const authorizationStatusTone: Record<
  SeriesCreationGrantStatus,
  "success" | "neutral" | "warning" | "danger"
> = {
  available: "success",
  reserved: "warning",
  consumed: "neutral",
  invalidated: "danger",
};

export function grantOptionLabel(grant: SeriesCreationGrantListItem): string {
  return grant.reference
    ? `${grant.displayCode} — ${grant.reference}`
    : grant.displayCode;
}
