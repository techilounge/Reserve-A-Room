import { CircleCheck, Hourglass, Link2Off, MailQuestion, MessageSquareText, Utensils, UtensilsCrossed } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { CancelReservation } from "@/components/reservations/cancel-reservation";
import { CapacityWarning } from "@/components/reservations/capacity-warning";
import { DetailList } from "@/components/reservations/detail-list";
import { StatusBadge } from "@/components/reservations/status-badge";
import { Button } from "@/components/ui/button";
import { formatInstant, formatLongDate, formatTimeRange, toLocalParts } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { FOOD_COPY } from "@/lib/domain/rooms/policy";
import { loadGuestReservation, type GuestReservation } from "@/lib/reservations/guest-access";
import { site } from "@/lib/site";

import { cancelReservationAction } from "./actions";

export const metadata: Metadata = {
  title: "Your Reservation",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function ReservationStatusPage({ params, searchParams }: PageProps<"/reservation/[reference]">) {
  const { reference } = await params;
  const { submitted } = await searchParams;
  const [lookup, catalog] = await Promise.all([loadGuestReservation(reference), loadCatalog()]);
  const timeZone = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";

  if (!lookup.ok) {
    return (
      <div className="page-container py-10 sm:py-14">
        <EmptyState
          icon={lookup.reason === "no_token" ? MailQuestion : Link2Off}
          title={lookup.reason === "rate_limited" ? "Please try again shortly" : "We couldn't open this reservation"}
          action={
            <Button asChild variant="outline">
              <Link href="/">Return to Home</Link>
            </Button>
          }
        >
          {lookup.reason === "rate_limited"
            ? "Too many attempts. Please wait a few minutes and try again."
            : lookup.reason === "unavailable"
              ? "Reservations can't be loaded right now. Please try again in a moment."
              : "To view your reservation, open the link in your confirmation email on this device. For help, contact the church office."}
        </EmptyState>
      </div>
    );
  }

  const r = lookup.reservation;
  // The confirmation banner only makes sense while the reservation is still active
  // (e.g. not after the guest cancels from this same page).
  const justSubmitted = submitted === "1" && (r.status === "pending" || r.status === "approved");

  return (
    <div className="page-container flex max-w-3xl flex-col gap-6 py-10 sm:py-14">
      {justSubmitted ? <Confirmation reservation={r} /> : <Heading reservation={r} />}

      <section aria-labelledby="details-heading" className="rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 id="details-heading" className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Reservation reference
            </h2>
            <p className="mt-1 font-mono text-2xl font-bold tracking-wider">{r.reference_code}</p>
          </div>
          <StatusBadge status={r.status} className="text-sm" />
        </div>

        <DetailList
          className="mt-6"
          items={[
            { label: "Room", value: r.room_name },
            { label: "Date", value: formatLongDate(toLocalParts(r.start_at, timeZone).date) },
            { label: "Time", value: formatTimeRange(toLocalParts(r.start_at, timeZone).time, toLocalParts(r.end_at, timeZone).time) },
            { label: "Ministry / group", value: r.ministry_name },
            { label: "Purpose", value: r.purpose, wide: true },
            { label: "Estimated attendance", value: `${r.estimated_attendance} ${r.estimated_attendance === 1 ? "person" : "people"}` },
            {
              label: "Food & drinks",
              value: (
                <span className="inline-flex items-center gap-1.5">
                  {r.food_drinks_allowed_at_submission ? (
                    <Utensils className="size-4" aria-hidden />
                  ) : (
                    <UtensilsCrossed className="size-4" aria-hidden />
                  )}
                  {r.food_drinks_allowed_at_submission ? FOOD_COPY.allowed.notice : FOOD_COPY.notAllowed.notice}
                </span>
              ),
              wide: true,
            },
            r.setup_requirements ? { label: "Setup requirements", value: r.setup_requirements, wide: true } : null,
            r.requester_notes ? { label: "Your notes", value: r.requester_notes, wide: true } : null,
            { label: "Submitted", value: formatInstant(r.created_at, timeZone) },
          ]}
        />

        <CapacityWarning className="mt-6" estimated={r.estimated_attendance} capacity={r.room_capacity_at_submission} />
      </section>

      {r.requester_message ? (
        <section className="flex gap-3 rounded-xl border bg-card p-5">
          <MessageSquareText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
          <div>
            <h2 className="font-semibold">Message from the church office</h2>
            <p className="mt-1 whitespace-pre-line text-muted-foreground">{r.requester_message}</p>
          </div>
        </section>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <Button asChild>
          <Link href="/reserve">Reserve Another Room</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Return to Home</Link>
        </Button>
      </div>

      {r.can_cancel ? (
        <section aria-labelledby="cancel-heading" className="rounded-xl border border-dashed p-5">
          <h2 id="cancel-heading" className="font-semibold">
            Need to cancel?
          </h2>
          <p className="mt-1 mb-4 text-sm text-muted-foreground">
            If your plans change, please cancel so the room is available for others.
          </p>
          <CancelReservation action={cancelReservationAction.bind(null, r.reference_code)} />
        </section>
      ) : null}

      <p className="text-sm text-muted-foreground">
        Keep your confirmation email — its link opens this page on any device. Questions? Visit{" "}
        <a href={site.churchWebsite} className="underline underline-offset-4">
          {site.churchWebsiteLabel}
        </a>
        .
      </p>
    </div>
  );
}

function Confirmation({ reservation }: { reservation: GuestReservation }) {
  const pending = reservation.status === "pending";
  const Icon = pending ? Hourglass : CircleCheck;
  return (
    <div
      role="status"
      className={
        pending
          ? "flex gap-4 rounded-xl border border-info-border bg-info-soft p-5 text-info-soft-foreground"
          : "flex gap-4 rounded-xl border border-success-border bg-success-soft p-5 text-success-soft-foreground"
      }
    >
      <Icon className="mt-1 size-7 shrink-0" aria-hidden />
      <div className="space-y-1">
        <h1 className="text-2xl font-bold">{pending ? "Reservation Request Submitted" : "Room Reserved"}</h1>
        <p className="font-medium">
          {pending ? "Your reservation request has been submitted for review." : "Your reservation has been confirmed."}
        </p>
        <p className="text-sm">
          {pending
            ? "A confirmation has been sent to your email. You will receive another notification when your reservation is reviewed."
            : "A confirmation has been sent to your email."}
        </p>
      </div>
    </div>
  );
}

function Heading({ reservation }: { reservation: GuestReservation }) {
  const copy = {
    pending: "Your request is waiting for review by the church office.",
    approved: "Your reservation is confirmed.",
    declined: "This reservation request was not approved.",
    cancelled: reservation.cancelled_by_requester ? "You cancelled this reservation." : "This reservation was cancelled.",
  }[reservation.status];
  return (
    <div className="space-y-1">
      <h1 className="text-3xl font-bold">Your Reservation</h1>
      <p className="text-muted-foreground">{copy}</p>
    </div>
  );
}
