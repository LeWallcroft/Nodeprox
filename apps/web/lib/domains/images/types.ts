import type { InitiatedUpload } from "../uploads/types";

export type ImageReplacementUploadGrant = InitiatedUpload["transfer"];

export type PreparedImageReplacement = {
  replacementId: string;
  imageId: string;
  upload: ImageReplacementUploadGrant;
};

export type CanonicalImageReplacementResult = {
  imageId: string;
  versionId: string;
  version: number;
  filename: string;
  publicUrl: string;
};

export type ImageReplacementPhase =
  | "idle"
  | "preparing"
  | "uploading"
  | "completing"
  | "success"
  | "error";
