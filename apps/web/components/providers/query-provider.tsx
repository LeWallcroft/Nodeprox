"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { isBrowserPerformanceEnabled } from "../../lib/performance/performance-flags";
import {
  createBrowserPerformanceBuffer,
  installCoreWebVitals,
  installRoutePerformance,
} from "../../lib/performance/web-vitals";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const pathname = usePathname() ?? "/";
  const initialPathname = useRef(pathname);
  const firstRoute = useRef(true);
  const performanceObserver = useRef<
    ReturnType<typeof createBrowserPerformanceBuffer> | undefined
  >(undefined);
  useEffect(() => {
    if (!isBrowserPerformanceEnabled()) return;
    const observer = createBrowserPerformanceBuffer((batch) => {
      console.info("performance.samples", JSON.stringify(batch));
    });
    performanceObserver.current = observer;
    installCoreWebVitals(observer, initialPathname.current);
    const flush = () => observer.flush();
    const flushOnHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", flushOnHidden);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", flushOnHidden);
      flush();
      performanceObserver.current = undefined;
    };
  }, []);
  useEffect(() => {
    if (!isBrowserPerformanceEnabled()) return;
    const observer = performanceObserver.current;
    if (!observer) return;
    const kind = firstRoute.current ? "document" : "spa";
    firstRoute.current = false;
    const disconnect = installRoutePerformance(
      observer,
      pathname,
      kind,
      kind === "document",
    );
    return () => {
      disconnect();
    };
  }, [pathname]);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
