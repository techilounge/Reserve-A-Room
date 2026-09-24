import { ArrowLeft, CircleCheck, Mail, Pencil, Phone, TriangleAlert } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminNotesForm } from "@/components/admin/admin-notes-form";
import { ReservationActions } from "@/components/admin/reservation-actions";
import { RetryEmailButton } from "@/components/admin/retry-email-button";
import { ApprovalBadge, FoodPolicyBadge } from "@/components/rooms/policy-badges";
import { CapacityWarning } from "@/components/reservations/capacity-warning";
import { DetailList } from "@/components/reservations/detail-list";
import { StatusBadge } from "@/components/reservations/status-badge";
import { Button } from "@/components/ui/button";
import { formatInstant, formatLongDate, formatTimeRange, toLocalParts } from "@/lib/datetime";
import { getReservation, getReservationEmails, type EmailLogRow } from "@/lib/data/admin";
import { loadCatalog } from "@/lib/data/catalog";
import { formatPhone } from "@/lib/format";
import { approvalLabel, EMAIL_EVENT_LABELS } from "@/lib/reservations/labels";

export const metadata: Metadata = {
  title: "Reservation",
};

export default async function AdminReservationPage({ params, searchParams }: PageProps<"/admin/reservations/[id]">) {
  const { id } = await params;
  const flags = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();

  const [r, emails, catalog] = await Promise.all([getReservation(id), getReservationEmails(id).catch(() => []), loadCatalog()]);
  if (!r) notFound();
  const timeZone = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";
  const start = toLocalParts(r.start_at, timeZone);
  const end = toLocalParts(r.end_at, timeZone);
  const active = r.status === "pending" || r.status === "approved";
  const foodChanged = r.food_drinks_allowed_at_submission !== r.room_food_drinks_allowed;

  const timeline = [
    { label: "Submitted", at: r.created_at, by: r.created_by_name ? `by ${r.created_by_name}` : "by the requester" },
    r.approved_at ? { label: "Approved", at: r.approved_at, by: r.approved_by_name ? `by ${r.approved_by_name}` : "automatically (instant room)" } : null,
    r.declined_at ? { label: "Declined", at: r.declined_at, by: r.declined_by_name ? `by ${r.declined_by_name}` : "" } : null,
    r.cancelled_at
      ? { label: "Cancelled", at: r.cancelled_at, by: r.cancelled_by_requester ? "by the requester" : r.cancelled_by_name ? `by ${r.cancelled_by_name}` : "" }
      : null,
  ].filter((x): x is { label: string; at: string; by: string } => Boolean(x));

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/reservations" className="inline-flex w-fit items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All reservations
      </Link>

      {flags.updated === "1" || flags.created === "1" ? (
        <p role="status" className="flex items-center gap-2 rounded-lg border border-success-border bg-success-soft p-3 text-sm text-success-soft-foreground">
          <CircleCheck className="size-4 shrink-0" aria-hidden />
          {flags.created === "1" ? "Reservation created and confirmed." : "Reservation updated."}
        </p>
      ) : null}

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          <p className="font-mono text-sm text-muted-foreground">{r.reference_code}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">
            {r.room_name} · {formatLongDate(start.date)}
          </h1>
          <p className="text-lg text-muted-foreground">{formatTimeRange(start.time, end.time)}</p>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={r.status} />
            <span className="text-sm text-muted-foreground">{approvalLabel(r)}</span>
          </div>
        </div>
        {active ? (
          <div className="flex flex-wrap gap-2">
            <ReservationActions reservationId={r.id} reference={r.reference_code} status={r.status} />
            <Button asChild variant="outline">
              <Link href={`/admin/reservations/${r.id}/edit`}>
                <Pencil data-icon="inline-start" aria-hidden />
                Edit
              </Link>
            </Button>
          </div>
        ) : null}
      </div>

      <CapacityWarning estimated={r.estimated_attendance} capacity={r.room_capacity} audience="staff" />
      {r.room_capacity !== r.room_capacity_at_submission ? (
        <p className="text-sm text-muted-foreground">
          The room&apos;s capacity was {r.room_capacity_at_submission} when this was booked; it is now {r.room_capacity}.
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="flex flex-col gap-6">
          <section aria-labelledby="requester-heading" className="rounded-xl border bg-card p-5">
            <h2 id="requester-heading" className="mb-4 font-semibold">
              Requester
            </h2>
            <DetailList
              items={[
                { label: "Name", value: `${r.requester_first_name} ${r.requester_last_name}` },
                { label: "Ministry / group", value: r.ministry_name ?? r.other_ministry_name ?? "—" },
                {
                  label: "Email",
                  value: (
                    <a href={`mailto:${r.requester_email}`} className="inline-flex items-center gap-1.5 break-all underline-offset-4 hover:underline">
                      <Mail className="size-4 shrink-0" aria-hidden />
                      {r.requester_email}
                    </a>
                  ),
                },
                {
                  label: "Phone",
                  value: (
                    <a href={`tel:${r.requester_phone}`} className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
                      <Phone className="size-4 shrink-0" aria-hidden />
                      {formatPhone(r.requester_phone)}
                    </a>
                  ),
                },
              ]}
            />
          </section>

          <section aria-labelledby="request-heading" className="rounded-xl border bg-card p-5">
            <h2 id="request-heading" className="mb-4 font-semibold">
              Request
            </h2>
            <DetailList
              items={[
                { label: "Purpose", value: r.purpose, wide: true },
                { label: "Estimated attendance", value: `${r.estimated_attendance} (room holds ${r.room_capacity})` },
                { label: "Source", value: r.source === "admin" ? "Created by staff" : "Guest request" },
                r.setup_requirements ? { label: "Setup requirements", value: r.setup_requirements, wide: true } : null,
                r.requester_notes ? { label: "Requester notes", value: r.requester_notes, wide: true } : null,
                r.requester_message ? { label: "Message sent to requester", value: r.requester_message, wide: true } : null,
              ]}
            />
          </section>

          <section aria-labelledby="notes-heading" className="rounded-xl border bg-card p-5">
            <h2 id="notes-heading" className="sr-only">
              Private notes
            </h2>
            <AdminNotesForm key={r.updated_at} reservationId={r.id} initial={r.admin_notes ?? ""} />
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="policies-heading" className="rounded-xl border bg-card p-5">
            <h2 id="policies-heading" className="mb-3 font-semibold">
              Room policies
            </h2>
            <div className="flex flex-wrap gap-2">
              <ApprovalBadge required={r.approval_required_at_submission} />
              <FoodPolicyBadge allowed={r.food_drinks_allowed_at_submission} />
            </div>
            <p className="mt-3 text-xs text-muted-foreground">As shown to the requester when they booked.</p>
            {foodChanged ? (
              <p className="mt-2 flex items-start gap-1.5 text-sm text-warning-soft-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                The room&apos;s food and drinks policy has changed since this was booked.
              </p>
            ) : null}
          </section>

          <section aria-labelledby="timeline-heading" className="rounded-xl border bg-card p-5">
            <h2 id="timeline-heading" className="mb-3 font-semibold">
              History
            </h2>
            <ol className="space-y-3 border-l pl-4">
              {timeline.map((t) => (
                <li key={t.label} className="text-sm">
                  <p className="font-medium">
                    {t.label} {t.by}
                  </p>
                  <p className="text-muted-foreground">{formatInstant(t.at, timeZone)}</p>
                </li>
              ))}
            </ol>
          </section>

          <section aria-labelledby="emails-heading" className="rounded-xl border bg-card p-5">
            <h2 id="emails-heading" className="mb-3 font-semibold">
              Emails
            </h2>
            {emails.length === 0 ? (
              <p className="text-sm text-muted-foreground">No emails for this reservation.</p>
            ) : (
              <ul className="space-y-3">
                {emails.map((e) => {
                  const label = EMAIL_EVENT_LABELS[e.event_type] ?? e.event_type;
                  return (
                    <li key={e.id} className="text-sm">
                      <p className="font-medium">{label}</p>
                      <p className="break-all text-muted-foreground">{e.recipient}</p>
                      <p className={e.status === "failed" ? "font-medium text-destructive" : "text-muted-foreground"}>
                        {emailStatusText(e, timeZone)}
                      </p>
                      {e.status === "failed" || e.status === "skipped" ? (
                        <div className="mt-2">
                          <RetryEmailButton reservationId={r.id} emailId={e.id} label={label} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

function emailStatusText(e: EmailLogRow, timeZone: string): string {
  switch (e.status) {
    case "sent":
      return `Sent ${formatInstant(e.sent_at ?? e.created_at, timeZone)}`;
    case "queued":
    case "sending":
      return "Sending…";
    case "skipped":
      return "Not sent: email delivery isn't configured.";
    case "failed":
      return `Not delivered${e.error_message ? `: ${e.error_message}` : "."}`;
  }
}
