export interface PublicMediaOriginResolver {
  originFor(storageProfileId: string): Promise<string>;
}
