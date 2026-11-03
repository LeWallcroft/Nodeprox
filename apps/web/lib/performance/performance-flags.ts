export function isBrowserPerformanceEnabled(
  value = process.env.NEXT_PUBLIC_NODEPROX_WEB_PERF_ENABLED,
): boolean {
  return value === "true";
}

export function isServerPerformanceEnabled(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return environment.NODEPROX_WEB_PERF_ENABLED === "true";
}
