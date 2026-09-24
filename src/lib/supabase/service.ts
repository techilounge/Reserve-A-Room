import "server-only";

import { createClient } from "@supabase/supabase-js";

import { getSupabasePublicConfig } from "@/lib/env/public";
import { requireServerSecret } from "@/lib/env/server";

import type { Database } from "./database.types";

/**
 * Service-role client. BYPASSES Row Level Security, so it is only used by trusted
 * server code for:
 *   - guest reservation creation / lookup / cancellation (after validation, rate
 *     limiting and token checks)
 *   - staff invitations and account bans (Supabase Auth admin API)
 *   - the email outbox
 * Never import this from a Client Component (`server-only` enforces it).
 */
export function createSupabaseServiceClient() {
  const { url } = getSupabasePublicConfig();
  return createClient<Database>(url, requireServerSecret("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
