"use server";

import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/guards";
import { createSupabaseServerClient } from "@/lib/supabase/server";

const BASE = "/admin/calendar-conflicts";

export async function saveConflictDecision(form: FormData) {
  await assertPermission("calendar.view");
  const fingerprint = String(form.get("fingerprint") ?? "");
  const decisionType = String(form.get("decision_type") ?? "");
  const selected = String(form.get("selected") ?? "");
  const reason = String(form.get("reason") ?? "").trim();
  if (!/^[a-f0-9]{32}$/.test(fingerprint) || !["advance", "acknowledge"].includes(decisionType) ||
    (decisionType === "advance" ? !/^[0-9a-f-]{36}$/i.test(selected) : selected !== "") ||
    reason.length < 3 || reason.length > 1000) redirect(`${BASE}?error=decision`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("calendar_record_conflict_decision", {
    p_fingerprint: fingerprint, p_decision_type: decisionType, p_reason: reason,
    ...(selected ? { p_selected_event: selected } : {}),
  });
  redirect(`${BASE}?${error ? "error=decision" : "updated=decision"}`);
}

export async function saveConflictPolicy(form: FormData) {
  await assertPermission("churchCalendar.manage");
  const threshold = Number(form.get("threshold"));
  if (!Number.isSafeInteger(threshold) || threshold < 1 || threshold > 100000) redirect(`${BASE}?error=policy`);
  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.rpc("calendar_conflict_policy_save", { p_threshold: threshold });
  redirect(`${BASE}?${error ? "error=policy" : "updated=policy"}`);
}
