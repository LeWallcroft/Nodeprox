import { apiRequestBrowser } from "../../api/browser";
import type { OverviewReadModel } from "./types";

export function getOverview(): Promise<OverviewReadModel> {
  return apiRequestBrowser<OverviewReadModel>("/overview");
}
