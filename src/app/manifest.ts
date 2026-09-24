import type { MetadataRoute } from "next";

import { site } from "@/lib/site";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: `${site.appName} · ${site.churchShortName}`,
    short_name: site.appName,
    description: site.description,
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#f7f9fc",
    theme_color: "#031e47",
    categories: ["productivity", "utilities"],
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Reserve a Room", url: "/reserve", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
      { name: "Check Availability", url: "/availability", icons: [{ src: "/icons/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
