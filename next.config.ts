import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

/**
 * Content-Security-Policy (ADR-29). Next.js streams inline bootstrap scripts, and
 * next-themes sets the theme with an inline script before paint, so script-src allows
 * 'unsafe-inline'. Nonces would force every page to render dynamically, which costs the
 * static room pages their caching. The policy still blocks third-party scripts, plugins,
 * framing, <base> hijacking, off-site form posts and connections to unknown origins.
 */
function contentSecurityPolicy(): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
  const supabaseOrigin = supabase?.origin ?? "";
  const supabaseSocket = supabase ? `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}` : "";
  const turnstile = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? "https://challenges.cloudflare.com" : "";

  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": ["'self'", "'unsafe-inline'", turnstile, isDev ? "'unsafe-eval'" : ""],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:", supabaseOrigin],
    "font-src": ["'self'", "data:"],
    "connect-src": ["'self'", supabaseOrigin, supabaseSocket, turnstile, isDev ? "ws:" : ""],
    "frame-src": turnstile ? [turnstile] : ["'none'"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "media-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };
  const policy = Object.entries(directives).map(([name, values]) => [name, ...values.filter(Boolean)].join(" "));
  // Only on Vercel: local production runs (`next start` against a local Supabase) use http.
  if (process.env.VERCEL) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

/** Security headers for every response. */
const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy() },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The E2E suite builds into its own folder (it bakes in the mock Supabase URL).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  env: {
    // Versions the service worker URL (/sw.js?v=…) so each deployment installs a fresh one.
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? Date.now().toString(36),
  },
  images: {
    // Room photos live in the public `room-images` Supabase Storage bucket.
    remotePatterns: [
      { protocol: "https", hostname: "*.supabase.co", pathname: "/storage/v1/object/public/room-images/**" },
    ],
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Guest reservation links carry a secret token; never leak it via the Referer header.
      { source: "/reservation/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
      { source: "/admin/:path*", headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }] },
      {
        // The service worker must always be revalidated, and may only load itself.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
