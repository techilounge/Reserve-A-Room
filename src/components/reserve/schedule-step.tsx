"use client";

import { CircleCheck, LoaderCircle } from "lucide-react";
import { useFormContext, useWatch } from "react-hook-form";

import { Field, fieldProps } from "@/components/forms/field";
import { DatePicker } from "@/components/forms/date-picker";
import { ApprovalBadge, CapacityBadge, FoodPolicyBadge } from "@/components/rooms/policy-badges";
import { NativeSelect } from "@/components/ui/native-select";
import { formatTime, type LocalDate, type LocalTime } from "@/lib/datetime";
import { advanceLabel } from "@/lib/domain/rooms/advance-booking";
import { cn } from "@/lib/utils";
import type { ReservationInput } from "@/lib/validation/reservation";

import { AdvanceNotice, ApprovalNotice, FoodNotice } from "./room-notices";
import type { ReserveRoom } from "./types";

export function ScheduleStep({
  rooms,
  today,
  startOptions,
  endOptions,
  availabilityStatus,
  onRoomChange,
  onDateChange,
  onStartChange,
}: {
  rooms: ReserveRoom[];
  today: LocalDate;
  startOptions: LocalTime[];
  endOptions: LocalTime[];
  availabilityStatus: "idle" | "loading" | "ready" | "error";
  onRoomChange: (roomId: string) => void;
  onDateChange: (date: LocalDate) => void;
  onStartChange: (start: LocalTime) => void;
}) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ReservationInput>();
  const [roomId, date, start, end] = useWatch<ReservationInput, ["roomId", "date", "start", "end"]>({
    name: ["roomId", "date", "start", "end"],
  });
  const room = rooms.find((r) => r.id === roomId);

  return (
    <div className="space-y-6">
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Room <span className="text-destructive" aria-hidden>*</span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {rooms.map((r) => (
            <label
              key={r.id}
              data-selected={roomId === r.id}
              className={cn(
                "relative flex cursor-pointer flex-col gap-2 rounded-xl border border-brand-gold/50 bg-card p-4 shadow-sm ring-1 ring-brand-gold/25 transition-[border-color,box-shadow,transform] hover:-translate-y-0.5 hover:border-brand-gold hover:shadow-md hover:ring-2 hover:ring-brand-gold/60 has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-offset-3 has-[:focus-visible]:outline-ring data-[selected=true]:border-brand-gold data-[selected=true]:shadow-md data-[selected=true]:ring-2 data-[selected=true]:ring-brand-gold dark:ring-brand-gold/40 dark:hover:ring-brand-gold/80",
              )}
            >
              <input
                type="radio"
                value={r.id}
                className="sr-only"
                {...register("roomId", { onChange: (e) => onRoomChange(e.target.value) })}
                aria-labelledby={`room-${r.id}-name`}
                aria-describedby={`room-${r.id}-policies`}
              />
              <span className="flex items-start justify-between gap-2">
                <span id={`room-${r.id}-name`} className="font-semibold">
                  {r.name}
                </span>
                {roomId === r.id ? <CircleCheck className="size-5 shrink-0 text-gold-text" aria-hidden /> : null}
              </span>
              <span id={`room-${r.id}-policies`} className="flex flex-wrap gap-1.5">
                <CapacityBadge capacity={r.capacity} />
                <ApprovalBadge required={r.approvalRequired} />
                <FoodPolicyBadge allowed={r.foodDrinksAllowed} />
                <span className="sr-only">Can be reserved up to {advanceLabel(r.advance)} in advance.</span>
              </span>
            </label>
          ))}
        </div>
        {errors.roomId?.message ? <p className="text-sm font-medium text-destructive">{errors.roomId.message}</p> : null}
      </fieldset>

      {room ? (
        <div className="space-y-3 rounded-xl border bg-muted/40 p-4">
          <ApprovalNotice room={room} />
          <FoodNotice room={room} />
          <AdvanceNotice room={room} />
        </div>
      ) : null}

      <Field
        id="reserve-date"
        label="Date"
        required
        error={errors.date?.message}
        description={room ? `Choose a date through the next ${advanceLabel(room.advance)}.` : "Choose a room first."}
      >
        <DatePicker
          id="reserve-date"
          describedBy={fieldProps("reserve-date", errors.date?.message, true)["aria-describedby"]}
          invalid={Boolean(errors.date)}
          value={date || null}
          minDate={today}
          maxDate={room?.horizon ?? today}
          onChange={onDateChange}
          placeholder={room ? "Choose a date" : "Choose a room first"}
          disabled={!room}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="reserve-start" label="Start time" required error={errors.start?.message}>
          <NativeSelect
            {...fieldProps("reserve-start", errors.start?.message)}
            value={start}
            disabled={!room || !date || availabilityStatus !== "ready"}
            onChange={(e) => onStartChange(e.target.value)}
          >
            <option value="">{availabilityStatus === "loading" ? "Checking availability…" : "Select a start time"}</option>
            {startOptions.map((t) => (
              <option key={t} value={t}>
                {formatTime(t)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="reserve-end" label="End time" required error={errors.end?.message}>
          <NativeSelect
            {...fieldProps("reserve-end", errors.end?.message)}
            {...register("end")}
            value={end}
            disabled={!start || availabilityStatus !== "ready"}
          >
            <option value="">Select an end time</option>
            {endOptions.map((t) => (
              <option key={t} value={t}>
                {formatTime(t)}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      <div role="status" aria-live="polite" className="text-sm text-muted-foreground">
        {availabilityStatus === "loading" ? (
          <span className="inline-flex items-center gap-2">
            <LoaderCircle className="size-4 animate-spin" aria-hidden />
            Checking availability…
          </span>
        ) : availabilityStatus === "error" ? (
          <span className="text-destructive">Availability couldn&apos;t be loaded. Please try again.</span>
        ) : availabilityStatus === "ready" && room && date && startOptions.length === 0 ? (
          <span>No times are available on this date. Please choose another date or room.</span>
        ) : null}
      </div>
    </div>
  );
}
