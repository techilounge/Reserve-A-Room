import "server-only";

import { z } from "zod";

import { ConfigurationError } from "@/lib/env/public";

/**
 * Server-only secrets. Importing this module from a Client Component fails the build
 * (`server-only`), so these values can never reach the browser.
 */

const optionalString = z
  .string()
  .trim()
  .transform((value) => value || undefined)
  .optional();

const serverSchema = z.object({
  SUPABASE_SERVICE_ROLE_KEY: optionalString,
  RESEND_API_KEY: optionalString,
  RESEND_FROM_EMAIL: optionalString,
  RESEND_REPLY_TO: optionalString,
  RATE_LIMIT_SECRET: optionalString,
  GUEST_LINK_SECRET: optionalString,
  TURNSTILE_SECRET_KEY: optionalString,
  CRON_SECRET: optionalString,
  APP_TIMEZONE: z.string().trim().default("America/Chicago"),
  VERCEL_ENV: optionalString,
});

export type ServerEnv = z.infer<typeof serverSchema>;

let cached: ServerEnv | undefined;

export function getServerEnv(): ServerEnv {
  cached ??= serverSchema.parse(process.env);
  return cached;
}

export function isProductionDeployment(): boolean {
  return getServerEnv().VERCEL_ENV === "production";
}

export function requireServerSecret<K extends keyof ServerEnv>(key: K): NonNullable<ServerEnv[K]> {
  const value = getServerEnv()[key];
  if (!value) throw new ConfigurationError(key);
  return value as NonNullable<ServerEnv[K]>;
}
