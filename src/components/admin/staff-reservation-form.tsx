"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle, Lock, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState, useTransition } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

import { createStaffReservationAction, updateReservationAction } from "@/app/admin/(portal)/reservations/actions";
import { fetchDayAvailability } from "@/app/(public)/reserve/actions";
import { DatePicker } from "@/components/forms/date-picker";
import { Field, fieldProps } from "@/components/forms/field";
import { DetailsStep } from "@/components/reserve/details-step";
import { AdvanceNotice, ApprovalNotice, FoodNotice } from "@/components/reserve/room-notices";
import type { ReserveRoom, ReserveSettings } from "@/components/reserve/types";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatTime, type LocalDate } from "@/lib/datetime";
import { availableEndTimes, availableStartTimes, type BusyBlock, type DayWindow } from "@/lib/domain/availability";
import { reservationSchema, type ReservationInput, type ReservationValues } from "@/lib/validation/reservation";

type Original = { roomId: string; startAt: string; endAt: string };

export function StaffReservationForm({
  mode,
  reservationId,
  rooms,
  ministries,
  settings,
  today,
  defaults,
  adminNotes: initialNotes = "",
  original,
  isApproved = false,
}: {
  mode: "create" | "edit";
  reservationId?: string;
  rooms: ReserveRoom[];
  ministries: { id: string; name: string }[];
  settings: ReserveSettings;
  today: LocalDate;
  defaults: ReservationInput;
  adminNotes?: string;
  /** The reservation's current slot, which must not count as "busy" while editing it. */
  original?: Original;
  isApproved?: boolean;
}) {
  const form = useForm<ReservationInput, unknown, ReservationValues>({
    resolver: zodResolver(reservationSchema),
    mode: "onTouched",
    defaultValues: defaults,
  });
  const { register, setValue, setError, getValues, formState } = form;
  const [adminNotes, setAdminNotes] = useState(initialNotes);
  const [notify, setNotify] = useState(true);
  const [error, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [availability, setAvailability] = useState<{ key: string; busy: BusyBlock[]; ok: boolean } | null>(null);

  const [roomId, date, start] = useWatch({ control: form.control, name: ["roomId", "date", "start"] });
  const room = rooms.find((r) => r.id === roomId);
  const key = room && date ? `${room.id}:${date}` : null;

  useEffect(() => {
    if (!key || !room || !date) return;
    let cancelled = false;
    fetchDayAvailability(room.id, date).then((result) => {
      if (cancelled) return;
      const busy = result.ok
        ? result.busy.filter(
            (b) =>
              !(
                original &&
                original.roomId === room.id &&
                new Date(b.start_at).getTime() === new Date(original.startAt).getTime() &&
                new Date(b.end_at).getTime() === new Date(original.endAt).getTime()
              ),
          )
        : [];
      setAvailability({ key, busy, ok: result.ok });
    });
    return () => {
      cancelled = true;
    };
  }, [key, room, date, original]);

  const ready = availability?.key === key && availability.ok;
  const window: DayWindow | null = useMemo(
    () => (date ? { date, ...settings, timeZone: settings.timeZone } : null),
    [date, settings],
  );
  const busy = ready ? availability!.busy : [];
  const startOptions = window && ready ? availableStartTimes(window, busy) : [];
  const endOptions = window && ready && start ? availableEndTimes(window, busy, start) : [];
  // Keep the current values selectable while availability loads.
  const withCurrent = (options: string[], current: string) => (current && !options.includes(current) ? [current, ...options] : options);

  function submit(values: ReservationInput) {
    setFormError(null);
    startTransition(async () => {
      const payload = { reservation: values, adminNotes, notify };
      const result =
        mode === "create" ? await createStaffReservationAction(payload) : await updateReservationAction(reservationId!, payload);
      if (!result || result.ok) return;
      setFormError(result.message);
      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        setError(field as keyof ReservationInput, { message });
      }
    });
  }

  return (
    <FormProvider {...form}>
      <form noValidate onSubmit={form.handleSubmit(() => submit(getValues()))} className="flex flex-col gap-6">
        {error ? (
          <div role="alert" className="flex gap-3 rounded-lg border border-danger-border bg-danger-soft p-4 text-sm text-danger-soft-foreground">
            <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
            <p>{error}</p>
          </div>
        ) : null}

        <section aria-labelledby="schedule-heading" className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
          <h2 id="schedule-heading" className="text-lg font-semibold">
            Room and time
          </h2>
          <Field id="roomId" label="Room" required error={formState.errors.roomId?.message}>
            <NativeSelect
              {...fieldProps("roomId", formState.errors.roomId?.message)}
              {...register("roomId", {
                onChange: () => {
                  setValue("start", "");
                  setValue("end", "");
                },
              })}
            >
              <option value="">Select a room</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} (up to {r.capacity})
                </option>
              ))}
            </NativeSelect>
          </Field>
          {room ? (
            <div className="space-y-2">
              {mode === "create" ? (
                <p className="text-sm text-muted-foreground">Reservations created by staff are confirmed immediately.</p>
              ) : (
                <ApprovalNotice room={room} />
              )}
              <FoodNotice room={room} />
              <AdvanceNotice room={room} />
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="date" label="Date" required error={formState.errors.date?.message}>
              <DatePicker
                id="date"
                value={date || null}
                minDate={today}
                maxDate={room?.horizon ?? today}
                disabled={!room}
                invalid={Boolean(formState.errors.date)}
                onChange={(value) => {
                  setValue("date", value, { shouldValidate: true });
                  setValue("start", "");
                  setValue("end", "");
                }}
              />
            </Field>
            <Field id="start" label="Start" required error={formState.errors.start?.message}>
              <NativeSelect
                {...fieldProps("start", formState.errors.start?.message)}
                {...register("start", {
                  onChange: (e) => {
                    const ends = window ? availableEndTimes(window, busy, e.target.value) : [];
                    if (!ends.includes(getValues("end"))) setValue("end", ends[0] ?? "");
                  },
                })}
                disabled={!room || !date}
              >
                <option value="">{key && !ready ? "Checking…" : "Start time"}</option>
                {withCurrent(startOptions, getValues("start")).map((t) => (
                  <option key={t} value={t}>
                    {formatTime(t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="end" label="End" required error={formState.errors.end?.message}>
              <NativeSelect {...fieldProps("end", formState.errors.end?.message)} {...register("end")} disabled={!start}>
                <option value="">End time</option>
                {withCurrent(endOptions, getValues("end")).map((t) => (
                  <option key={t} value={t}>
                    {formatTime(t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>
        </section>

        <section aria-labelledby="details-heading" className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
          <h2 id="details-heading" className="text-lg font-semibold">
            Requester details
          </h2>
          <DetailsStep room={room} ministries={ministries} />
        </section>

        <section aria-labelledby="staff-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
          <h2 id="staff-heading" className="text-lg font-semibold">
            Staff options
          </h2>
          <div className="space-y-1.5">
            <Label htmlFor="adminNotes" className="gap-1.5">
              <Lock className="size-3.5" aria-hidden />
              Private staff notes <span className="font-normal text-muted-foreground">(never shared)</span>
            </Label>
            <Textarea id="adminNotes" rows={3} maxLength={4000} value={adminNotes} onChange={(e) => setAdminNotes(e.target.value)} />
          </div>
          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              className="mt-0.5 size-5 accent-[var(--primary)]"
            />
            <span>
              <span className="font-medium">Email the requester</span>
              <span className="block text-muted-foreground">
                {mode === "create"
                  ? "Send the confirmation with their reservation link."
                  : isApproved
                    ? "If the room, date or time changes, let them know."
                    : "Pending requests are only emailed when approved or declined."}
              </span>
            </span>
          </label>
        </section>

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <Button asChild variant="outline" size="lg">
            <Link href={mode === "edit" ? `/admin/reservations/${reservationId}` : "/admin/reservations"}>Cancel</Link>
          </Button>
          <Button type="submit" size="lg" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            {pending ? "Saving…" : mode === "create" ? "Create reservation" : "Save changes"}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
