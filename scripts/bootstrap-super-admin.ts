// One-time setup of the first Super Admin. There is deliberately NO web page for this.
//
//   1. Put these in .env.local (or export them in the shell):
//        NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
//        NEXT_PUBLIC_APP_URL (e.g. https://reservearoom.stonehillchurch.org),
//        INITIAL_SUPER_ADMIN_EMAIL, optionally INITIAL_SUPER_ADMIN_NAME
//   2. npm run bootstrap:super-admin
//   3. Open the printed link (valid for a limited time) to choose a password.
//
// Safe to re-run: once a Super Admin exists it refuses to create another, but it will
// print a fresh password-setup link for that same person (e.g. if the first expired).
import { createClient } from "@supabase/supabase-js";

import type { Database } from "../src/lib/supabase/database.types.ts";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    console.error(`✖ Missing ${name}. Add it to .env.local (see .env.example).`);
    process.exit(1);
  }
  return value;
}

const url = required("NEXT_PUBLIC_SUPABASE_URL");
const serviceKey = required("SUPABASE_SERVICE_ROLE_KEY");
const appUrl = required("NEXT_PUBLIC_APP_URL").replace(/\/+$/, "");
const email = required("INITIAL_SUPER_ADMIN_EMAIL").toLowerCase();
const fullName = process.env.INITIAL_SUPER_ADMIN_NAME?.trim() || email.split("@")[0];

const supabase = createClient<Database>(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function findUserByEmail(target: string) {
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    const match = data.users.find((u) => u.email?.toLowerCase() === target);
    if (match || data.users.length < 1000) return match ?? null;
  }
}

function setupLink(hashedToken: string, type: "invite" | "recovery"): string {
  const link = new URL("/admin/auth/confirm", appUrl);
  link.searchParams.set("token_hash", hashedToken);
  link.searchParams.set("type", type);
  link.searchParams.set("next", "/admin/set-password");
  return link.toString();
}

async function main() {
  const { data: existing, error: existingError } = await supabase
    .from("profiles")
    .select("id, email")
    .eq("role", "super_admin")
    .eq("active", true);
  if (existingError) throw existingError;

  if (existing.length > 0 && !existing.some((p) => p.email === email)) {
    console.error("✖ A Super Admin already exists. Add more administrators from Users & Roles in the app.");
    process.exit(1);
  }

  const user = await findUserByEmail(email);
  const type = user ? "recovery" : "invite";
  const redirectTo = `${appUrl}/admin/set-password`;
  const { data: link, error: linkError } = await supabase.auth.admin.generateLink(
    type === "invite" ? { type, email, options: { redirectTo } } : { type, email, options: { redirectTo } },
  );
  if (linkError) throw linkError;

  if (existing.length === 0) {
    const { error } = await supabase.rpc("bootstrap_first_super_admin", {
      p_user_id: link.user.id,
      p_full_name: fullName,
    });
    if (error) throw error;
    console.log(`✔ ${email} is now the first Super Admin.`);
  } else {
    console.log(`✔ ${email} is already the Super Admin. Generated a new password-setup link.`);
  }

  console.log("\nOpen this link to choose a password (it expires soon; re-run this script if it does):\n");
  console.log(`  ${setupLink(link.properties.hashed_token, type)}\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : JSON.stringify(error);
  console.error(`✖ Bootstrap failed: ${message}`);
  process.exit(1);
});
