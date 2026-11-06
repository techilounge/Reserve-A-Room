"use server";

import { redirect } from "next/navigation";
import { assertPermission } from "@/lib/auth/guards";
import { scheduleSystemEmailDelivery } from "@/lib/email/schedule";
import { createSupabaseServiceClient } from "@/lib/supabase/service";

export async function queueDueReminders() {
  await assertPermission("churchCalendar.manage");
  const {data,error}=await createSupabaseServiceClient().rpc("calendar_queue_due_reminders",{p_limit:50});
  if (error) redirect("/admin/church-calendar/planning?reminders=error");
  scheduleSystemEmailDelivery();
  redirect(`/admin/church-calendar/planning?reminders=${data ?? 0}`);
}
