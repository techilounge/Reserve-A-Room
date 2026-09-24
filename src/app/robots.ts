import type { MetadataRoute } from "next";

import { getAppUrl } from "@/lib/app-url";

export default function robots(): MetadataRoute.Robots {
  // Only production is indexable; previews and local builds ask crawlers to stay out.
  if (process.env.VERCEL_ENV !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/reservation/"] },
    sitemap: new URL("/sitemap.xml", getAppUrl()).toString(),
  };
}
