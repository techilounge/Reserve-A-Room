import type { MetadataRoute } from "next";

import { getAppUrl } from "@/lib/app-url";

const PUBLIC_PATHS = ["/", "/rooms", "/availability", "/reserve"] as const;

export default function sitemap(): MetadataRoute.Sitemap {
  const base = getAppUrl();
  return PUBLIC_PATHS.map((path) => ({ url: new URL(path, base).toString() }));
}
