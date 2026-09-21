import type { InitiatedUpload } from "../uploads/types";

export type ImageReplacementUploadGrant = InitiatedUpload["transfer"];

export type PreparedImageReplacement = {
  replacementId: string;
  imageId: string;
  upload: ImageReplacementUploadGrant;
};

export type CanonicalImageReplacementResult = {
  replacementId: string;
  imageId: string;
  chapterId: string;
  status: "uploaded" | "completing" | "completed";
};

export type ImageReplacementPhase =
  | "idle"
  | "preparing"
  | "uploading"
  | "completing"
  | "success"
  | "error";
