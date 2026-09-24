"use client";

import { useEffect } from "react";

/**
 * Registers public/sw.js in production builds. The build id in the URL makes every
 * deployment install a fresh worker (see ADR-12). Development never registers one, so
 * hot reloading isn't affected by caching.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const url = `/sw.js?v=${encodeURIComponent(process.env.NEXT_PUBLIC_BUILD_ID ?? "1")}`;
    navigator.serviceWorker.register(url, { scope: "/", updateViaCache: "none" }).catch((error: unknown) => {
      console.warn("Service worker registration failed", error);
    });
  }, []);
  return null;
}
