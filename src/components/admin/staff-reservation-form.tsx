"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CalendarCheck, CircleCheck, CircleX, LoaderCircle, Lock, Plus, Repeat2, Trash2, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

import {
  createStaffReservationAction,
  previewRecurringReservationAction,
  updateReservationAction,
  type RecurrencePreviewResult,
} from "@/app/admin/(portal)/reservations/actions";
import { fetchDayAvailability } from "@/app/(public)/reserve/actions";
import { DatePicker } from "@/components/forms/date-picker";
import { Field, fieldProps } from "@/components/forms/field";
import { DetailsStep } from "@/components/reserve/details-step";
import { AdvanceNotice, ApprovalNotice, FoodNotice } from "@/components/reserve/room-notices";
import type { ReserveRoom, ReserveSettings } from "@/components/reserve/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { addMonthsToLocalDate, formatShortDate, formatTime, type LocalDate } from "@/lib/datetime";
import { availableEndTimes, availableStartTimes, type BusyBlock, type DayWindow } from "@/lib/domain/availability";
import { weekdayOf } from "@/lib/recurrence/dates";
import type { MonthlyOrdinal } from "@/lib/recurrence/types";
import { reservationSchema, type ReservationInput, type ReservationValues } from "@/lib/validation/reservation";
import type { StaffRecurrenceInput } from "@/lib/validation/staff-reservation";

type Original = { roomId: string; startAt: string; endAt: string };
type RepeatFrequency =
  | "none"
  | "daily"
  | "weekdays"
  | "weekly"
  | "monthly_day"
  | "monthly_nth_weekday"
  | "yearly_date"
  | "yearly_nth_weekday";

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;
const ORDINALS = [
  { value: 1, label: "First" },
  { value: 2, label: "Second" },
  { value: 3, label: "Third" },
  { value: 4, label: "Fourth" },
  { value: -1, label: "Last" },
] as const;
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

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
  const formRef = useRef<HTMLFormElement>(null);
  const [notify, setNotify] = useState(true);
  const [error, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [previewPending, startPreviewTransition] = useTransition();
  const [availability, setAvailability] = useState<{ key: string; busy: BusyBlock[]; ok: boolean } | null>(null);
  const [repeat, setRepeat] = useState<RepeatFrequency>("none");
  const [weekday, setWeekday] = useState(weekdayOf(today));
  const [weekdays, setWeekdays] = useState<number[]>([weekdayOf(today)]);
  const [interval, setInterval] = useState(1);
  const [dayOfMonth, setDayOfMonth] = useState(Number(today.slice(-2)));
  const [month, setMonth] = useState(Number(today.slice(5, 7)));
  const [ordinal, setOrdinal] = useState<MonthlyOrdinal>(1);
  const [ordinals, setOrdinals] = useState<MonthlyOrdinal[]>([1]);
  const [hasEndDate, setHasEndDate] = useState(false);
  const [recurrenceEndDate, setRecurrenceEndDate] = useState<LocalDate | null>(null);
  const [previewResult, setPreviewResult] = useState<RecurrencePreviewResult | null>(null);
  const [recurrenceError, setRecurrenceError] = useState<string | null>(null);

  const [roomId, date, start, end] = useWatch({ control: form.control, name: ["roomId", "date", "start", "end"] });
  const room = rooms.find((r) => r.id === roomId);
  const key = room && date ? `${room.id}:${date}` : null;

  useEffect(() => {
    formRef.current?.setAttribute("data-interactive", "true");
  }, []);

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

  const recurrence = useMemo<StaffRecurrenceInput>(() => {
    if (mode !== "create" || repeat === "none") return { frequency: "none" };
    const endDate = hasEndDate ? recurrenceEndDate ?? undefined : undefined;
    switch (repeat) {
      case "daily":
        return { frequency: repeat, interval, endDate };
      case "weekdays":
        return { frequency: repeat, endDate };
      case "weekly":
        return { frequency: repeat, interval, weekdays, endDate };
      case "monthly_day":
        return { frequency: repeat, interval, dayOfMonth, endDate };
      case "monthly_nth_weekday":
        return { frequency: repeat, interval, weekday, ordinals, endDate };
      case "yearly_date":
        return { frequency: repeat, month, dayOfMonth, endDate };
      case "yearly_nth_weekday":
        return { frequency: repeat, month, weekday, ordinal, endDate };
    }
  }, [dayOfMonth, hasEndDate, interval, mode, month, ordinal, ordinals, recurrenceEndDate, repeat, weekday, weekdays]);

  function resetRecurrencePreview() {
    setPreviewResult(null);
    setRecurrenceError(null);
  }

  function addMonthlyOrdinal() {
    const next = ORDINALS.find((item) => !ordinals.includes(item.value));
    if (!next) return;
    resetRecurrencePreview();
    setOrdinals((current) => [...current, next.value]);
  }

  function updateMonthlyOrdinal(index: number, value: MonthlyOrdinal) {
    resetRecurrencePreview();
    setOrdinals((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function removeMonthlyOrdinal(index: number) {
    resetRecurrencePreview();
    setOrdinals((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  function submit(values: ReservationInput) {
    setFormError(null);
    setRecurrenceError(null);
    startTransition(async () => {
      const payload = { reservation: values, recurrence, adminNotes, notify };
      const result =
        mode === "create" ? await createStaffReservationAction(payload) : await updateReservationAction(reservationId!, payload);
      if (!result || result.ok) return;
      setFormError(result.message);
      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        if (field === "recurrence" || field === "recurrenceEndDate") setRecurrenceError(message);
        else setError(field as keyof ReservationInput, { message });
      }
    });
  }

  function previewRecurrence() {
    setRecurrenceError(null);
    setPreviewResult(null);
    startPreviewTransition(async () => {
      const result = await previewRecurringReservationAction({
        roomId: getValues("roomId"),
        date: getValues("date"),
        start: getValues("start"),
        end: getValues("end"),
        recurrence,
      });
      setPreviewResult(result);
      if (!result.ok) setRecurrenceError(result.message);
    });
  }

  return (
    <FormProvider {...form}>
      <form
        ref={formRef}
        noValidate
        data-interactive="false"
        onSubmit={form.handleSubmit(() => submit(getValues()))}
        className="flex flex-col gap-6"
      >
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
                  resetRecurrencePreview();
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
                  resetRecurrencePreview();
                  setValue("date", value, { shouldValidate: true });
                  setValue("start", "");
                  setValue("end", "");
                  if (mode === "create") {
                    const selectedWeekday = weekdayOf(value);
                    setWeekday(selectedWeekday);
                    setWeekdays([selectedWeekday]);
                    setDayOfMonth(Number(value.slice(-2)));
                    setMonth(Number(value.slice(5, 7)));
                  }
                }}
              />
            </Field>
            <Field id="start" label="Start" required error={formState.errors.start?.message}>
              <NativeSelect
                {...fieldProps("start", formState.errors.start?.message)}
                {...register("start", {
                  onChange: (e) => {
                    resetRecurrencePreview();
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
              <NativeSelect
                {...fieldProps("end", formState.errors.end?.message)}
                {...register("end", { onChange: resetRecurrencePreview })}
                disabled={!start}
              >
                <option value="">End time</option>
                {withCurrent(endOptions, getValues("end")).map((t) => (
                  <option key={t} value={t}>
                    {formatTime(t)}
                  </option>
                ))}
              </NativeSelect>
            </Field>
          </div>

          {mode === "create" ? (
            <div className="space-y-4 rounded-xl border border-dashed bg-muted/30 p-4">
              <div className="flex items-start gap-3">
                <Repeat2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden />
                <div>
                  <h3 className="font-semibold">Repeat this reservation</h3>
                  <p className="text-sm text-muted-foreground">
                    Build a daily, weekly, monthly, or yearly schedule. Expansion stops after one year or 50 instances.
                  </p>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <Field id="repeat" label="Repeats">
                  <NativeSelect
                    id="repeat"
                    value={repeat}
                    onChange={(event) => {
                      resetRecurrencePreview();
                      setRepeat(event.target.value as RepeatFrequency);
                    }}
                  >
                    <option value="none">Does not repeat</option>
                    <option value="daily">Every X days</option>
                    <option value="weekdays">Every weekday</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly_day">Monthly on a date</option>
                    <option value="monthly_nth_weekday">Monthly on a weekday</option>
                    <option value="yearly_date">Yearly on a date</option>
                    <option value="yearly_nth_weekday">Yearly on a weekday</option>
                  </NativeSelect>
                </Field>
                {repeat === "daily" || repeat === "weekly" || repeat === "monthly_day" || repeat === "monthly_nth_weekday" ? (
                  <Field id="recurrence-interval" label={`Every X ${repeat === "daily" ? "days" : repeat === "weekly" ? "weeks" : "months"}`}>
                    <Input
                      id="recurrence-interval"
                      type="number"
                      min={1}
                      max={repeat === "daily" ? 365 : repeat === "weekly" ? 52 : 12}
                      value={interval}
                      onChange={(event) => {
                        resetRecurrencePreview();
                        setInterval(Number(event.target.value));
                      }}
                    />
                  </Field>
                ) : null}
                {repeat === "monthly_nth_weekday" || repeat === "yearly_nth_weekday" ? (
                  <Field id="recurrence-weekday" label="Day of week">
                    <NativeSelect
                      id="recurrence-weekday"
                      value={weekday}
                      onChange={(event) => {
                        resetRecurrencePreview();
                        setWeekday(Number(event.target.value) as typeof weekday);
                      }}
                    >
                      {WEEKDAYS.map((name, index) => (
                        <option key={name} value={index}>
                          {name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : null}
                {repeat === "yearly_nth_weekday" ? (
                  <Field id="recurrence-ordinal" label="Week of month">
                    <NativeSelect
                      id="recurrence-ordinal"
                      value={ordinal}
                      onChange={(event) => {
                        resetRecurrencePreview();
                        setOrdinal(Number(event.target.value) as typeof ordinal);
                      }}
                    >
                      {ORDINALS.map((item) => (
                        <option key={item.value} value={item.value}>
                          {item.label}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : null}
                {repeat === "monthly_day" || repeat === "yearly_date" ? (
                  <Field id="recurrence-day" label="Day of month">
                    <Input
                      id="recurrence-day"
                      type="number"
                      min={1}
                      max={31}
                      value={dayOfMonth}
                      onChange={(event) => {
                        resetRecurrencePreview();
                        setDayOfMonth(Number(event.target.value));
                      }}
                    />
                  </Field>
                ) : null}
                {repeat === "yearly_date" || repeat === "yearly_nth_weekday" ? (
                  <Field id="recurrence-month" label="Month">
                    <NativeSelect
                      id="recurrence-month"
                      value={month}
                      onChange={(event) => {
                        resetRecurrencePreview();
                        setMonth(Number(event.target.value));
                      }}
                    >
                      {MONTHS.map((name, index) => (
                        <option key={name} value={index + 1}>
                          {name}
                        </option>
                      ))}
                    </NativeSelect>
                  </Field>
                ) : null}
              </div>

              {repeat === "monthly_nth_weekday" ? (
                <fieldset className="space-y-3">
                  <legend className="text-sm font-medium">Weeks of month</legend>
                  <div className="grid gap-3 sm:max-w-xl">
                    {ordinals.map((selectedOrdinal, index) => {
                      const selectId = index === 0 ? "recurrence-ordinal" : `recurrence-ordinal-${index}`;
                      const selectedLabel = ORDINALS.find((item) => item.value === selectedOrdinal)?.label ?? "selected";
                      return (
                        <div key={index} className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2">
                          <Field id={selectId} label={index === 0 ? "Week of month" : `Additional week of month ${index + 1}`}>
                            <NativeSelect
                              id={selectId}
                              value={selectedOrdinal}
                              onChange={(event) => updateMonthlyOrdinal(index, Number(event.target.value) as MonthlyOrdinal)}
                            >
                              {ORDINALS.map((item) => (
                                <option
                                  key={item.value}
                                  value={item.value}
                                  disabled={item.value !== selectedOrdinal && ordinals.includes(item.value)}
                                >
                                  {item.label}
                                </option>
                              ))}
                            </NativeSelect>
                          </Field>
                          {ordinals.length > 1 ? (
                            <Button
                              type="button"
                              variant="outline"
                              size="icon"
                              onClick={() => removeMonthlyOrdinal(index)}
                              aria-label={`Remove ${selectedLabel.toLowerCase()} week of month`}
                            >
                              <Trash2 aria-hidden />
                            </Button>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={addMonthlyOrdinal}
                    disabled={ordinals.length >= ORDINALS.length}
                  >
                    <Plus aria-hidden />
                    Add week of month
                  </Button>
                </fieldset>
              ) : null}

              {repeat === "weekly" ? (
                <fieldset className="space-y-2">
                  <legend className="text-sm font-medium">Repeat on</legend>
                  <div className="flex flex-wrap gap-2">
                    {WEEKDAYS.map((name, index) => {
                      const checked = weekdays.includes(index);
                      return (
                        <label
                          key={name}
                          className="flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 text-sm has-checked:border-primary has-checked:bg-primary/10"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => {
                              resetRecurrencePreview();
                              setWeekdays((current) =>
                                checked ? current.filter((day) => day !== index) : [...current, index].sort(),
                              );
                            }}
                            className="size-4 accent-[var(--primary)]"
                          />
                          {name.slice(0, 3)}
                        </label>
                      );
                    })}
                  </div>
                </fieldset>
              ) : null}

              {repeat !== "none" ? (
                <>
                  <label className="flex items-start gap-3 text-sm">
                    <input
                      type="checkbox"
                      checked={hasEndDate}
                      onChange={(event) => {
                        resetRecurrencePreview();
                        setHasEndDate(event.target.checked);
                        if (!event.target.checked) setRecurrenceEndDate(null);
                      }}
                      className="mt-0.5 size-5 accent-[var(--primary)]"
                    />
                    <span>
                      <span className="font-medium">Set an end date</span>
                      <span className="block text-muted-foreground">Leave unchecked to use the one-year or 50-instance limit.</span>
                    </span>
                  </label>
                  {hasEndDate ? (
                    <div className="max-w-sm">
                      <Field id="recurrence-end-date" label="End date" required>
                        <DatePicker
                          id="recurrence-end-date"
                          value={recurrenceEndDate}
                          minDate={(date || today) as LocalDate}
                          maxDate={addMonthsToLocalDate((date || today) as LocalDate, 12)}
                          disabled={!date}
                          onChange={(value) => {
                            resetRecurrencePreview();
                            setRecurrenceEndDate(value);
                          }}
                        />
                      </Field>
                    </div>
                  ) : null}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={previewRecurrence}
                    disabled={previewPending || !room || !date || !start || !end}
                  >
                    {previewPending ? <LoaderCircle className="animate-spin" aria-hidden /> : <CalendarCheck aria-hidden />}
                    {previewPending ? "Checking schedule…" : "Preview schedule"}
                  </Button>

                  {recurrenceError ? (
                    <p role="alert" className="text-sm font-medium text-destructive">
                      {recurrenceError}
                    </p>
                  ) : null}
                  {previewResult?.ok ? (
                    <div className="space-y-3 rounded-lg border bg-card p-4" aria-live="polite">
                      <div>
                        <p className="font-semibold">{previewResult.preview.label}</p>
                        <p className="text-sm text-muted-foreground">
                          {previewResult.preview.occurrences.length} occurrence
                          {previewResult.preview.occurrences.length === 1 ? "" : "s"} currently inside this room&apos;s booking window through {formatShortDate(previewResult.materializedThrough)}.
                        </p>
                      </div>
                      <dl className="grid gap-2 rounded-lg bg-muted/50 p-3 text-sm sm:grid-cols-2">
                        <div>
                          <dt className="font-medium text-muted-foreground">Start date</dt>
                          <dd className="font-semibold">{formatShortDate(previewResult.preview.seriesStartDate)}</dd>
                        </div>
                        <div>
                          <dt className="font-medium text-muted-foreground">End date</dt>
                          <dd className="font-semibold">
                            {formatShortDate(previewResult.preview.seriesEndDate)}
                            {previewResult.preview.seriesEndIsAutomatic ? " (automatic limit)" : ""}
                          </dd>
                        </div>
                      </dl>
                      {previewResult.preview.continuesAfterPreview ? (
                        <p className="text-sm text-muted-foreground">
                          The series continues beyond this room&apos;s current booking window; later occurrences are added as dates become bookable.
                        </p>
                      ) : null}
                      <ul className="grid gap-2 text-sm sm:grid-cols-2">
                        {previewResult.preview.occurrences.slice(0, 12).map((occurrence) => (
                          <li key={occurrence.date} className="flex items-center gap-2">
                            {occurrence.status === "available" ? (
                              <CircleCheck className="size-4 shrink-0 text-success-soft-foreground" aria-hidden />
                            ) : (
                              <CircleX className="size-4 shrink-0 text-destructive" aria-hidden />
                            )}
                            <span>
                              {formatShortDate(occurrence.date)} · {occurrence.status === "available" ? "Available" : occurrence.status === "conflict" ? "Conflict" : "Invalid time"}
                            </span>
                          </li>
                        ))}
                      </ul>
                      {previewResult.preview.occurrences.length > 12 ? (
                        <p className="text-xs text-muted-foreground">And {previewResult.preview.occurrences.length - 12} more dates.</p>
                      ) : null}
                      {previewResult.preview.conflicts.length ? (
                        <p role="alert" className="text-sm font-medium text-destructive">
                          Resolve every conflict before creating this series. Creation is all-or-nothing.
                        </p>
                      ) : null}
                    </div>
                  ) : null}
                </>
              ) : null}
            </div>
          ) : null}
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
            {pending ? "Saving…" : mode === "create" && repeat !== "none" ? "Create recurring series" : mode === "create" ? "Create reservation" : "Save changes"}
          </Button>
        </div>
      </form>
    </FormProvider>
  );
}
