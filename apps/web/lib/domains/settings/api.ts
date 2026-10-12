import { apiRequestBrowser } from "../../api/browser";
import type { ProductSettings } from "./types";

export function getProductSettings() {
  return apiRequestBrowser<ProductSettings>("/admin/settings");
}

export function updateProductSettings(
  changes: Array<{ key: string; value: number | boolean | string }>,
) {
  return apiRequestBrowser<ProductSettings>("/admin/settings", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ changes }),
  });
}
