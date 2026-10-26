export type WorkerPerformanceConfig = Readonly<{
  enabled: boolean;
  sampleRate: number;
}>;

export function loadWorkerPerformanceConfig(
  env: Record<string, string | undefined> = process.env,
): WorkerPerformanceConfig {
  const enabled = env.NODEPROX_WORKER_PERF_ENABLED === "true";
  if (!enabled) return { enabled: false, sampleRate: 0 };
  const raw = env.NODEPROX_WORKER_PERF_SAMPLE_RATE;
  const sampleRate = raw === undefined ? 1 : Number(raw);
  if (!Number.isFinite(sampleRate) || sampleRate < 0 || sampleRate > 1)
    throw new Error("Invalid NODEPROX_WORKER_PERF_SAMPLE_RATE");
  return { enabled, sampleRate };
}
