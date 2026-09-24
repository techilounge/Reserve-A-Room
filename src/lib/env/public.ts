/**
 * Browser-safe configuration. Each NEXT_PUBLIC_* variable must be referenced literally
 * (process.env.NEXT_PUBLIC_X) so Next.js can inline it into client bundles.
 */

export class ConfigurationError extends Error {
  constructor(variable: string) {
    super(`Missing required environment variable ${variable}. See .env.example.`);
    this.name = "ConfigurationError";
  }
}

export function getSupabasePublicConfig(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url) throw new ConfigurationError("NEXT_PUBLIC_SUPABASE_URL");
  if (!publishableKey) throw new ConfigurationError("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  return { url, publishableKey };
}

export function isSupabaseConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

/** Cloudflare Turnstile is enabled only when both keys are present. */
export function getTurnstileSiteKey(): string | null {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || null;
}
