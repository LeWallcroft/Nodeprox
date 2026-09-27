import {
  LEGACY_STORAGE_PROFILE_ID,
  type ActiveStorageProfilePort,
  type StorageExecutionResolver,
} from "@nodeprox/storage/profile-execution";
import type { StoragePort, UploadTransferPort } from "@nodeprox/storage/port";

export const legacyStorageProfileId = LEGACY_STORAGE_PROFILE_ID;

export const legacyActiveProfile: ActiveStorageProfilePort = {
  getActiveStorageProfileId: async () => LEGACY_STORAGE_PROFILE_ID,
};

export function legacyStorageExecution(
  storage: StoragePort,
  transfer?: UploadTransferPort,
): StorageExecutionResolver {
  return {
    storageFor: async (profileId) => {
      if (profileId !== LEGACY_STORAGE_PROFILE_ID)
        throw new Error("unexpected-storage-profile");
      return storage;
    },
    uploadTransferFor: async (profileId) => {
      if (profileId !== LEGACY_STORAGE_PROFILE_ID || !transfer)
        throw new Error("unexpected-storage-profile-transfer");
      return transfer;
    },
  };
}
