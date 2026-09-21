import {
  type UploadTransferPort,
  UploadTransferProviderError,
} from "@nodeprox/storage/port";

export class UnavailableUploadTransfer implements UploadTransferPort {
  async initiate(): Promise<never> {
    throw new UploadTransferProviderError();
  }

  async verify(): Promise<never> {
    throw new UploadTransferProviderError();
  }

  async abort(): Promise<never> {
    throw new UploadTransferProviderError();
  }
}
