"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type ReactNode, useEffect, useState } from "react";
import {
  createBrowserPerformanceObserver,
  installBrowserPerformance,
} from "../../lib/performance/web-vitals";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  useEffect(() => {
    if (process.env.NEXT_PUBLIC_NODEPROX_WEB_PERF_ENABLED !== "true") return;
    const observer = createBrowserPerformanceObserver((sample) => {
      console.info("performance.sample", sample);
    });
    return installBrowserPerformance(observer);
  }, []);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
