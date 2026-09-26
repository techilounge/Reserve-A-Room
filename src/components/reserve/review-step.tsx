"use client";

import { Pencil, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useFormContext, useWatch } from "react-hook-form";

import { CapacityWarning } from "@/components/reservations/capacity-warning";
import { DetailList } from "@/components/reservations/detail-list";
import { Button } from "@/components/ui/button";
import { formatLongDate, formatTimeRange } from "@/lib/datetime";
import { formatPhone } from "@/lib/format";
import { OTHER_MINISTRY, type ReservationInput } from "@/lib/validation/reservation";
import { normalizePhone } from "@/lib/validation/text";

import { ApprovalNotice, FoodNotice } from "./room-notices";
import type { ReserveRoom } from "./types";

export function ReviewStep({
  room,
  ministries,
  onEdit,
}: {
  room: ReserveRoom;
  ministries: { id: string; name: string }[];
  onEdit: (step: "schedule" | "details") => void;
}) {
  const {
    control,
    register,
    formState: { errors },
  } = useFormContext<ReservationInput>();
  const v = useWatch({ control }) as Partial<Record<keyof ReservationInput, string>>;
  const ministry =
    v.ministryId === OTHER_MINISTRY ? v.otherMinistryName : ministries.find((m) => m.id === v.ministryId)?.name;
  const estimated = Number(v.estimatedAttendance);

  return (
    <div className="space-y-6">
      <ApprovalNotice room={room} />

      <section aria-labelledby="review-schedule" className="rounded-xl border p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 id="review-schedule" className="font-semibold">
            Room and time
          </h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit("schedule")}>
            <Pencil data-icon="inline-start" aria-hidden />
            Edit<span className="sr-only"> room and time</span>
          </Button>
        </div>
        <DetailList
          items={[
            { label: "Room", value: room.name },
            { label: "Capacity", value: `Up to ${room.capacity} people` },
            { label: "Date", value: v.date ? formatLongDate(v.date) : "—" },
            { label: "Time", value: v.start && v.end ? formatTimeRange(v.start, v.end) : "—" },
          ]}
        />
        <FoodNotice room={room} className="mt-4" />
      </section>

      <section aria-labelledby="review-details" className="rounded-xl border p-4 sm:p-5">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h3 id="review-details" className="font-semibold">
            Your details
          </h3>
          <Button type="button" variant="ghost" size="sm" onClick={() => onEdit("details")}>
            <Pencil data-icon="inline-start" aria-hidden />
            Edit<span className="sr-only"> your details</span>
          </Button>
        </div>
        <DetailList
          items={[
            { label: "Name", value: `${v.firstName ?? ""} ${v.lastName ?? ""}`.trim() },
            { label: "Email", value: v.email },
            { label: "Phone", value: displayPhone(v.phone) },
            { label: "Ministry / group", value: ministry },
            { label: "Purpose", value: v.purpose, wide: true },
            { label: "Estimated attendance", value: `${v.estimatedAttendance} ${estimated === 1 ? "person" : "people"}` },
            v.setupRequirements ? { label: "Setup requirements", value: v.setupRequirements, wide: true } : null,
            v.requesterNotes ? { label: "Additional notes", value: v.requesterNotes, wide: true } : null,
          ]}
        />
      </section>

      <CapacityWarning estimated={Number.isFinite(estimated) ? estimated : 0} capacity={room.capacity} />

      <section
        aria-labelledby="legal-consent-heading"
        className="rounded-xl border border-brand-gold/55 bg-warning-soft/45 p-4 shadow-sm ring-1 ring-brand-gold/20 sm:p-5"
      >
        <div className="flex gap-3">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-gold-text" aria-hidden />
          <div className="min-w-0 flex-1 space-y-3">
            <div>
              <h3 id="legal-consent-heading" className="font-semibold">
                Privacy &amp; Terms
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">
                Please review and accept both documents before submitting your reservation.
              </p>
            </div>
            <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border bg-card p-3 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
              <input
                id="legalAccepted"
                type="checkbox"
                className="mt-0.5 size-5 shrink-0 accent-primary"
                aria-invalid={errors.legalAccepted ? "true" : undefined}
                aria-describedby={errors.legalAccepted ? "legalAccepted-error" : undefined}
                {...register("legalAccepted")}
              />
              <span className="text-sm leading-6">
                I have read and accept the{" "}
                <Link
                  href="/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary underline decoration-brand-gold decoration-2 underline-offset-4 hover:text-gold-text"
                >
                  Privacy Policy
                </Link>{" "}
                and{" "}
                <Link
                  href="/terms"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="font-semibold text-primary underline decoration-brand-gold decoration-2 underline-offset-4 hover:text-gold-text"
                >
                  Terms of Service
                </Link>
                .
              </span>
            </label>
            {errors.legalAccepted?.message ? (
              <p id="legalAccepted-error" role="alert" className="text-sm font-medium text-destructive">
                {errors.legalAccepted.message}
              </p>
            ) : null}
          </div>
        </div>
      </section>
    </div>
  );
}

/** Shows the number the way it will be saved, e.g. "5125550123" → "(512) 555-0123". */
function displayPhone(value: string | undefined): string | undefined {
  if (!value) return value;
  const normalized = normalizePhone(value);
  return normalized ? formatPhone(normalized) : value;
}
