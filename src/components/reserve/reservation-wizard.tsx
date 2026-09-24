"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { ArrowLeft, ArrowRight, LoaderCircle, TriangleAlert, WifiOff } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { FormProvider, useForm, useWatch } from "react-hook-form";

import { fetchDayAvailability, submitReservation } from "@/app/(public)/reserve/actions";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { Button } from "@/components/ui/button";
import { useOnlineStatus } from "@/hooks/use-online-status";
import type { LocalDate, LocalTime } from "@/lib/datetime";
import { availableEndTimes, availableStartTimes, type BusyBlock, type DayWindow } from "@/lib/domain/availability";
import { cn } from "@/lib/utils";
import {
  reservationSchema,
  STEP_FIELDS,
  type ReservationInput,
  type ReservationValues,
} from "@/lib/validation/reservation";

import { DetailsStep } from "./details-step";
import { ReviewStep } from "./review-step";
import { ScheduleStep } from "./schedule-step";
import type { ReservePrefill, ReserveRoom, ReserveSettings } from "./types";

type Step = "schedule" | "details" | "review";
const STEPS: { id: Step; label: string }[] = [
  { id: "schedule", label: "Room & time" },
  { id: "details", label: "Your details" },
  { id: "review", label: "Review & submit" },
];

type Availability = { key: string; status: "ready" | "error"; busy: BusyBlock[] };

export function ReservationWizard({
  rooms,
  ministries,
  settings,
  today,
  prefill,
  turnstileSiteKey,
}: {
  rooms: ReserveRoom[];
  ministries: { id: string; name: string }[];
  settings: ReserveSettings;
  today: LocalDate;
  prefill: ReservePrefill;
  /** Set only when Turnstile is fully configured (site + secret key). */
  turnstileSiteKey: string | null;
}) {
  const form = useForm<ReservationInput, unknown, ReservationValues>({
    resolver: zodResolver(reservationSchema),
    mode: "onTouched",
    defaultValues: {
      roomId: prefill.roomId ?? (rooms.length === 1 ? rooms[0].id : ""),
      date: prefill.date ?? "",
      start: prefill.start ?? "",
      end: prefill.end ?? "",
      firstName: "",
      lastName: "",
      email: "",
      phone: "",
      ministryId: "",
      otherMinistryName: "",
      purpose: "",
      estimatedAttendance: "",
      setupRequirements: "",
      requesterNotes: "",
    },
  });
  const { setValue, setError, clearErrors, trigger, getValues } = form;

  const [step, setStep] = useState<Step>("schedule");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [refreshKey, setRefreshKey] = useState(0);
  const [availability, setAvailability] = useState<Availability | null>(null);
  const online = useOnlineStatus();
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const needsVerification = Boolean(turnstileSiteKey) && !turnstileToken;
  const startedAt = useRef<number>(0);
  const honeypot = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);

  const [roomId, date, start] = useWatch({ control: form.control, name: ["roomId", "date", "start"] });
  const room = rooms.find((r) => r.id === roomId);

  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  // Load occupied times whenever the room or date changes (or after a conflict).
  const availabilityKey = room && date ? `${room.id}:${date}:${refreshKey}` : null;
  useEffect(() => {
    if (!availabilityKey || !room || !date) return;
    let cancelled = false;
    fetchDayAvailability(room.id, date).then((result) => {
      if (cancelled) return;
      setAvailability({ key: availabilityKey, status: result.ok ? "ready" : "error", busy: result.ok ? result.busy : [] });
    });
    return () => {
      cancelled = true;
    };
  }, [availabilityKey, room, date]);

  const availabilityStatus = !availabilityKey
    ? "idle"
    : availability?.key === availabilityKey
      ? availability.status
      : "loading";

  const window: DayWindow | null = useMemo(
    () =>
      date
        ? {
            date,
            timeZone: settings.timeZone,
            dayStart: settings.dayStart,
            dayEnd: settings.dayEnd,
            intervalMinutes: settings.intervalMinutes,
            leadMinutes: settings.leadMinutes,
          }
        : null,
    [date, settings],
  );
  const busy = availabilityStatus === "ready" && availability ? availability.busy : [];
  const startOptions = window && availabilityStatus === "ready" ? availableStartTimes(window, busy) : [];
  const endOptions = window && start && availabilityStatus === "ready" ? availableEndTimes(window, busy, start) : [];

  // Move focus to the step heading so keyboard and screen reader users land in context.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    headingRef.current?.focus();
  }, [step]);

  function resetTimes() {
    setValue("start", "");
    setValue("end", "");
  }

  async function next() {
    setSubmitError(null);
    if (step === "schedule") {
      const valid = await trigger([...STEP_FIELDS.schedule], { shouldFocus: true });
      const { start: s, end: e } = getValues();
      if (valid && !startOptions.includes(s)) {
        setError("start", { message: "That start time isn't available. Please choose another." });
        return;
      }
      if (valid && !endOptions.includes(e)) {
        setError("end", { message: "That end time isn't available. Please choose another." });
        return;
      }
      if (valid) setStep("details");
    } else if (step === "details") {
      if (await trigger([...STEP_FIELDS.details], { shouldFocus: true })) setStep("review");
    }
  }

  function back() {
    setSubmitError(null);
    setStep(step === "review" ? "details" : "schedule");
  }

  function submit() {
    if (!online || pending) return;
    if (needsVerification) {
      setSubmitError("Please complete the verification check above the button.");
      return;
    }
    setSubmitError(null);
    startTransition(async () => {
      const result = await submitReservation(getValues(), {
        website: honeypot.current?.value ?? "",
        startedAt: startedAt.current,
        turnstileToken: turnstileToken ?? undefined,
      });
      // On success the action redirects; anything returned is a failure.
      if (!result) return;
      // Turnstile tokens are single-use: get a fresh one for the next attempt.
      if (turnstileSiteKey) {
        setTurnstileToken(null);
        setTurnstileKey((k) => k + 1);
      }
      setSubmitError(result.message);
      for (const [field, message] of Object.entries(result.fieldErrors ?? {})) {
        setError(field as keyof ReservationInput, { message });
      }
      if (result.kind === "conflict") {
        resetTimes();
        setRefreshKey((k) => k + 1);
      }
      if (result.step !== "review") setStep(result.step);
    });
  }

  const stepIndex = STEPS.findIndex((s) => s.id === step);
  const submitLabel = room?.approvalRequired ? "Submit Request" : "Reserve Room";
  const pendingLabel = room?.approvalRequired ? "Submitting…" : "Reserving…";

  return (
    <FormProvider {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          if (step === "review") submit();
          else void next();
        }}
        className="flex flex-col gap-6"
      >
        <ol className="grid grid-cols-3 gap-2" aria-label="Reservation steps">
          {STEPS.map((s, i) => (
            <li
              key={s.id}
              aria-current={s.id === step ? "step" : undefined}
              className={cn(
                "rounded-lg border-t-4 pt-2 text-xs font-medium sm:text-sm",
                i <= stepIndex ? "border-primary text-foreground" : "border-border text-muted-foreground",
              )}
            >
              <span className="block text-muted-foreground">Step {i + 1}</span>
              {s.label}
            </li>
          ))}
        </ol>

        <div className="rounded-xl border bg-card p-4 sm:p-6">
          <h2 ref={headingRef} tabIndex={-1} className="mb-5 text-xl font-semibold outline-none">
            {STEPS[stepIndex].label}
          </h2>

          {submitError ? (
            <div role="alert" className="mb-5 flex gap-3 rounded-lg border border-danger-border bg-danger-soft p-4 text-sm text-danger-soft-foreground">
              <TriangleAlert className="mt-0.5 size-5 shrink-0" aria-hidden />
              <p>{submitError}</p>
            </div>
          ) : null}

          {step === "schedule" ? (
            <ScheduleStep
              rooms={rooms}
              today={today}
              startOptions={startOptions}
              endOptions={endOptions}
              availabilityStatus={availabilityStatus}
              onRoomChange={(id) => {
                const nextRoom = rooms.find((r) => r.id === id);
                if (date && nextRoom && date > nextRoom.horizon) setValue("date", "");
                resetTimes();
                clearErrors(["roomId", "start", "end"]);
              }}
              onDateChange={(value: LocalDate) => {
                setValue("date", value, { shouldValidate: true });
                resetTimes();
              }}
              onStartChange={(value: LocalTime) => {
                setValue("start", value, { shouldValidate: true });
                const ends = window ? availableEndTimes(window, busy, value) : [];
                const currentEnd = getValues("end");
                if (!ends.includes(currentEnd)) setValue("end", ends[0] ?? "");
                clearErrors(["start", "end"]);
              }}
            />
          ) : step === "details" ? (
            <DetailsStep room={room} ministries={ministries} />
          ) : room ? (
            <>
              <ReviewStep room={room} ministries={ministries} onEdit={setStep} />
              {turnstileSiteKey ? (
                <TurnstileWidget key={turnstileKey} siteKey={turnstileSiteKey} onToken={setTurnstileToken} />
              ) : null}
            </>
          ) : null}

          {/* Honeypot: invisible to people, tempting to bots. */}
          <div aria-hidden className="absolute -left-[10000px] h-px w-px overflow-hidden">
            <label htmlFor="website">Leave this field empty</label>
            <input ref={honeypot} id="website" name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
          </div>
        </div>

        {!online ? (
          <p role="status" className="flex items-center gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning-soft-foreground">
            <WifiOff className="size-4 shrink-0" aria-hidden />
            You&apos;re offline. Connect to the internet to check availability or make a reservation.
          </p>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
          {step !== "schedule" ? (
            <Button type="button" variant="outline" size="lg" onClick={back} disabled={pending}>
              <ArrowLeft data-icon="inline-start" aria-hidden />
              Back
            </Button>
          ) : (
            <span />
          )}
          {step === "review" ? (
            <Button type="submit" size="lg" disabled={pending || !online} aria-disabled={pending || !online}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {pending ? pendingLabel : submitLabel}
            </Button>
          ) : (
            <Button type="submit" size="lg" disabled={step === "schedule" && availabilityStatus === "loading"}>
              Continue
              <ArrowRight data-icon="inline-end" aria-hidden />
            </Button>
          )}
        </div>
      </form>
    </FormProvider>
  );
}
