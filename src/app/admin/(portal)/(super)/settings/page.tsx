import type { Metadata } from "next";

import { SettingsForm } from "@/components/admin/settings-form";
import { PageHeader } from "@/components/layout/page-header";
import { normalizeTime } from "@/lib/datetime";
import { getAdminSettings } from "@/lib/data/super";

export const metadata: Metadata = {
  title: "Settings",
};

export default async function AdminSettingsPage() {
  const s = await getAdminSettings();
  const timezones = Intl.supportedValuesOf("timeZone");
  if (!timezones.includes(s.timezone)) timezones.unshift(s.timezone);

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <PageHeader title="Settings" description="Application-wide settings. Room-specific rules are set on each room." />
      <SettingsForm
        timezones={timezones}
        initial={{
          churchName: s.church_name,
          appName: s.app_name,
          timezone: s.timezone,
          contactEmail: s.contact_email ?? "",
          contactPhone: s.contact_phone ?? "",
          bookingIntervalMinutes: String(s.booking_interval_minutes),
          defaultAdvanceValue: String(s.default_max_advance_value),
          defaultAdvanceUnit: s.default_max_advance_unit,
          minLeadTimeMinutes: String(s.min_lead_time_minutes),
          bookableDayStart: normalizeTime(s.bookable_day_start),
          bookableDayEnd: normalizeTime(s.bookable_day_end),
          allowGuestCancellation: s.allow_guest_cancellation,
          extraRecipients: s.extra_admin_notification_emails.join(", "),
          emailSenderName: s.email_sender_name,
        }}
      />
    </div>
  );
}
