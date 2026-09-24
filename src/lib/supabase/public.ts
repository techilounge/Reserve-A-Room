import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "@/lib/env/public";

import type { Database } from "./database.types";

/**
 * Cookie-less anon client for public, cacheable reads (rooms, ministries, availability).
 * Runs as the `anon` role, so RLS limits it to public data. Not tied to a request, which
 * lets its results be cached across visitors.
 */
export function createSupabasePublicClient() {
  const { url, publishableKey } = getSupabasePublicConfig();
  return createClient<Database>(url, publishableKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}

/** Public URL of a room image stored in the `room-images` bucket. */
export function roomImageUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  const { url } = getSupabasePublicConfig();
  return `${url}/storage/v1/object/public/room-images/${imagePath.split("/").map(encodeURIComponent).join("/")}`;
}
