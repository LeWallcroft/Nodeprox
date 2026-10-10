export interface UploadPolicySettingsPort {
  readNumbers(keys: readonly string[]): Promise<ReadonlyMap<string, number>>;
}
