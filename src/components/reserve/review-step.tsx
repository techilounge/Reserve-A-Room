"use client";

import { Pencil } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";

import { CapacityWarning } from "@/components/reservations/capacity-warning";
import { DetailList } from "@/components/reservations/detail-list";
import { Button } from "@/components/ui/button";
import { formatLongDate, formatTimeRange } from "@/lib/datetime";
import { OTHER_MINISTRY, type ReservationInput } from "@/lib/validation/reservation";

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
  const { control } = useFormContext<ReservationInput>();
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
            { label: "Phone", value: v.phone },
            { label: "Ministry / group", value: ministry },
            { label: "Purpose", value: v.purpose, wide: true },
            { label: "Estimated attendance", value: `${v.estimatedAttendance} ${estimated === 1 ? "person" : "people"}` },
            v.setupRequirements ? { label: "Setup requirements", value: v.setupRequirements, wide: true } : null,
            v.requesterNotes ? { label: "Additional notes", value: v.requesterNotes, wide: true } : null,
          ]}
        />
      </section>

      <CapacityWarning estimated={Number.isFinite(estimated) ? estimated : 0} capacity={room.capacity} />
    </div>
  );
}
