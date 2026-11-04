import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PageHeader } from "@/components/layout/page-header";
import { formatInstant } from "@/lib/datetime";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { CalendarOccurrenceCancellationControl } from "@/components/admin/calendar-event-controls";
import { PHASE6_APPROVAL_UI_ENABLED } from "@/lib/calendar-planning/phase6-gate";

export const metadata: Metadata = { title: "Submitted Calendar Dates" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PAGE_SIZE = 25;
type Occurrence = { id: string; event_id: string; commitment_id: string | null; cancelled: boolean; can_cancel: boolean; local_start: string; local_end: string; timezone: string; all_day: boolean;
  occupancy_start: string; occupancy_end: string;
  rooms: { name: string; origin: string }[]; resources: { name: string; quantity: number; notes: string | null; origin: string }[] };

function displayRange(occurrence: Occurrence) {
  const start = occurrence.local_start.replace("T", " ").slice(0, 16);
  const end = occurrence.local_end.replace("T", " ").slice(0, 16);
  if (!occurrence.all_day) return `${start} to ${end}`;
  const last = new Date(`${end.slice(0, 10)}T00:00:00Z`);
  last.setUTCDate(last.getUTCDate() - 1);
  return `${start.slice(0, 10)} through ${last.toISOString().slice(0, 10)} · All day`;
}

export default async function SubmittedOccurrences({ params, searchParams }: {
  params: Promise<{ submissionId: string }>; searchParams: Promise<{ page?: string; error?: string; updated?: string }>;
}) {
  const { submissionId } = await params;
  if (!UUID.test(submissionId)) notFound();
  const query = await searchParams;
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase.rpc("calendar_staff_occurrences", { p_submission_id: submissionId });
  const occurrences = (data ?? []) as Occurrence[];
  const pages = Math.max(1, Math.ceil(occurrences.length / PAGE_SIZE));
  const page = Math.min(pages, Math.max(1, Number.parseInt(query.page ?? "1", 10) || 1));
  const href = (number: number) => `/admin/calendar-submissions/occurrences/${submissionId}?page=${number}`;
  return <div className="space-y-5">
    <Link className="underline" href="/admin/calendar-submissions">Back to submitted plans</Link>
    <PageHeader title="Submitted Calendar Dates" description={PHASE6_APPROVAL_UI_ENABLED ? "Review each date and its requested rooms and resources." : "These are immutable planning requests, not confirmed room or resource allocations."} />
    {query.updated ? <p role="status">This date was cancelled and its future commitments were released.</p> : null}
    {query.error ? <p role="alert">This date could not be cancelled. Refresh the page and check that it is still in the future.</p> : null}
    {error ? <p role="alert">These submitted dates are unavailable.</p> : null}
    {!error && !occurrences.length ? <p>No submitted dates are available.</p> : null}
    <ol className="space-y-3">{occurrences.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map(occurrence => <li key={occurrence.id} className="space-y-2 rounded-lg border bg-card p-4">
      <h2 className="font-semibold">{displayRange(occurrence)} ({occurrence.timezone})</h2>
      <p>Rooms requested: {occurrence.rooms.map(room => room.name).join(", ") || "None"}</p>
      <p>Resources requested: {occurrence.resources.map(resource => `${resource.name} (${resource.quantity})${resource.notes ? `: ${resource.notes}` : ""}`).join(", ") || "None"}</p>
      <p className="text-sm text-muted-foreground">Setup and cleanup occupancy: {formatInstant(occurrence.occupancy_start, occurrence.timezone)} to {formatInstant(occurrence.occupancy_end, occurrence.timezone)} ({occurrence.timezone})</p>
      {PHASE6_APPROVAL_UI_ENABLED && occurrence.commitment_id ? occurrence.cancelled ? <p>Cancelled</p> :
        occurrence.can_cancel ? <CalendarOccurrenceCancellationControl eventId={occurrence.event_id} commitmentId={occurrence.commitment_id} occurrenceId={occurrence.id} submissionId={submissionId} /> : <p>Past or in progress</p> : null}
    </li>)}</ol>
    {pages > 1 ? <nav className="flex items-center justify-between" aria-label="Submitted date pages">
      {page > 1 ? <Link className="underline" href={href(page - 1)}>Previous</Link> : <span />}
      <span>Page {page} of {pages}</span>
      {page < pages ? <Link className="underline" href={href(page + 1)}>Next</Link> : <span />}
    </nav> : null}
  </div>;
}
