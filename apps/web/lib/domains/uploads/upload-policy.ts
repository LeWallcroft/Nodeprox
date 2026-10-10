import type { UserUploadPolicy } from "@nodeprox/types";
import { apiRequestBrowser } from "../../api/browser";

export type { UserUploadPolicy } from "@nodeprox/types";

export function getUserUploadPolicy() {
  return apiRequestBrowser<UserUploadPolicy>("/me/upload-policy");
}
