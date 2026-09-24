type Env = Record<string, string | undefined>;

/**
 * Absolute base URL for links in metadata and emails.
 *
 * - Vercel preview deployments link to their own branch URL, so emails sent while
 *   testing a preview never point at production.
 * - Otherwise NEXT_PUBLIC_APP_URL (production: https://reservearoom.stonehillchurch.org).
 * - Falls back to the Vercel production URL, then localhost for development.
 */
export function getAppUrl(env: Env = process.env): URL {
  if (env.VERCEL_ENV === "preview" && env.VERCEL_BRANCH_URL) {
    return new URL(`https://${env.VERCEL_BRANCH_URL}`);
  }
  if (env.NEXT_PUBLIC_APP_URL) {
    return new URL(env.NEXT_PUBLIC_APP_URL);
  }
  if (env.VERCEL_PROJECT_PRODUCTION_URL) {
    return new URL(`https://${env.VERCEL_PROJECT_PRODUCTION_URL}`);
  }
  return new URL("http://localhost:3000");
}
