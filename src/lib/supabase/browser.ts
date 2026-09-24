"use client";

import { createBrowserClient } from "@supabase/ssr";

import { getSupabasePublicConfig } from "@/lib/env/public";

import type { Database } from "./database.types";

let client: ReturnType<typeof createBrowserClient<Database>> | undefined;

/** Browser client (publishable key only). Used for staff sign-in forms. */
export function getSupabaseBrowserClient() {
  if (!client) {
    const { url, publishableKey } = getSupabasePublicConfig();
    client = createBrowserClient<Database>(url, publishableKey);
  }
  return client;
}
