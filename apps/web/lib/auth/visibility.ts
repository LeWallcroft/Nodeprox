export function hasCapability(
  capabilities: readonly string[] | undefined,
  capability: string,
) {
  return Boolean(capabilities?.includes(capability));
}
