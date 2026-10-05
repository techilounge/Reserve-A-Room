"use client";

import { CalendarCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState, useTransition } from "react";

import {
  submitRecurringRequest,
  type RecurringRequestFormValues,
  type RecurringRequestState,
} from "@/app/(public)/recurring-request/actions";
import { Field, fieldProps } from "@/components/forms/field";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { formatTime, type LocalTime } from "@/lib/datetime";
import { TURNSTILE_ACTIONS } from "@/lib/security/turnstile-actions";

const INITIAL: RecurringRequestState = { status: "idle" };
const EMPTY_VALUES: RecurringRequestFormValues = {
  roomId: "",
  preferredStartDate: "",
  start: "",
  end: "",
  recurrenceDescription: "",
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  purpose: "",
  estimatedAttendance: "",
  requesterNotes: "",
  legalAccepted: false,
};

export function RecurringRequestForm({
  rooms,
  today,
  timeOptions,
  turnstileSiteKey,
}: {
  rooms: { id: string; name: string }[];
  today: string;
  timeOptions: LocalTime[];
  /** Set only when Turnstile is fully configured (site + secret key). */
  turnstileSiteKey: string | null;
}) {
  const [state, action, pending] = useActionState(submitRecurringRequest, INITIAL);
  const [, startTransition] = useTransition();
  const [startedAt] = useState(() => Date.now());
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [turnstileKey, setTurnstileKey] = useState(0);
  const [verificationNotice, setVerificationNotice] = useState<string | null>(null);
  const [values, setValues] = useState<RecurringRequestFormValues>(() => state.values ?? EMPTY_VALUES);
  const errors = state.fieldErrors ?? {};
  const startOptions = timeOptions.slice(0, -1);
  const endOptions = values.start ? timeOptions.filter((time) => time > values.start) : [];

  function setValue<Name extends keyof RecurringRequestFormValues>(
    name: Name,
    value: RecurringRequestFormValues[Name],
  ) {
    setValues((current) => ({ ...current, [name]: value }));
  }

  if (state.status === "success") {
    return (
      <section className="space-y-5 rounded-xl border border-success-border bg-success-soft p-6 text-success-soft-foreground">
        <CalendarCheck className="size-9" aria-hidden />
        <div className="space-y-2">
          <h2 className="text-xl font-semibold">Request received</h2>
          <p>{state.message}</p>
          <p>
            Your reference is <strong>{state.reference}</strong>. This is a request, not a confirmed reservation; a staff member will contact you.
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button asChild><Link href="/">Return home</Link></Button>
          <Button asChild variant="outline"><Link href="/reserve">Make a one-time reservation</Link></Button>
        </div>
      </section>
    );
  }

  return (
    <form
      action={action}
      onSubmit={(event) => {
        event.preventDefault();
        if (turnstileSiteKey && !turnstileToken) {
          setVerificationNotice("Please complete the verification check above the button.");
          return;
        }
        setVerificationNotice(null);
        const formData = new FormData(event.currentTarget);
        // Turnstile tokens are single-use: the token is already in the form data, so get a
        // fresh one for any further attempt.
        if (turnstileSiteKey) {
          setTurnstileToken(null);
          setTurnstileKey((key) => key + 1);
        }
        startTransition(() => action(formData));
      }}
      className="space-y-6"
      noValidate
    >
      <input type="hidden" name="startedAt" value={startedAt} />
      <input type="hidden" name="turnstileToken" value={turnstileToken ?? ""} />
      <div className="absolute -left-[10000px] top-auto size-px overflow-hidden" aria-hidden>
        <label htmlFor="request-website">Website</label>
        <input id="request-website" name="website" type="text" tabIndex={-1} autoComplete="off" />
      </div>

      {state.status === "error" ? (
        <p role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger-soft-foreground">{state.message}</p>
      ) : null}

      <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <div>
          <h2 className="text-lg font-semibold">Preferred schedule</h2>
          <p className="text-sm text-muted-foreground">Tell us what you need. Staff will confirm availability and finalize the schedule with you.</p>
        </div>
        <Field id="roomId" label="Room" required error={errors.roomId}>
          <NativeSelect name="roomId" value={values.roomId} onChange={(event) => setValue("roomId", event.target.value)} {...fieldProps("roomId", errors.roomId)}>
            <option value="" disabled>Choose a room</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </NativeSelect>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="preferredStartDate" label="Preferred start date" required error={errors.preferredStartDate}>
            <Input name="preferredStartDate" type="date" min={today} value={values.preferredStartDate} onChange={(event) => setValue("preferredStartDate", event.target.value)} {...fieldProps("preferredStartDate", errors.preferredStartDate)} />
          </Field>
          <Field id="start" label="Start time" required error={errors.start}>
            <NativeSelect
              name="start"
              value={values.start}
              onChange={(event) => {
                const next = event.target.value as LocalTime | "";
                setValues((current) => ({
                  ...current,
                  start: next,
                  end: current.end && current.end > next ? current.end : "",
                }));
              }}
              {...fieldProps("start", errors.start)}
            >
              <option value="">Select a start time</option>
              {startOptions.map((time) => <option key={time} value={time}>{formatTime(time)}</option>)}
            </NativeSelect>
          </Field>
          <Field id="end" label="End time" required error={errors.end}>
            <NativeSelect
              name="end"
              value={values.end}
              disabled={!values.start}
              onChange={(event) => setValue("end", event.target.value)}
              {...fieldProps("end", errors.end)}
            >
              <option value="">Select an end time</option>
              {endOptions.map((time) => <option key={time} value={time}>{formatTime(time)}</option>)}
            </NativeSelect>
          </Field>
        </div>
        <Field
          id="recurrenceDescription"
          label="How should it repeat?"
          required
          error={errors.recurrenceDescription}
          description="For example: the second and fourth Saturday of every month through May 2027."
        >
          <Textarea name="recurrenceDescription" rows={3} maxLength={1000} value={values.recurrenceDescription} onChange={(event) => setValue("recurrenceDescription", event.target.value)} placeholder="Describe the dates or repeating pattern" {...fieldProps("recurrenceDescription", errors.recurrenceDescription, true)} />
        </Field>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Your details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="firstName" label="First name" required error={errors.firstName}>
            <Input name="firstName" autoComplete="given-name" maxLength={80} value={values.firstName} onChange={(event) => setValue("firstName", event.target.value)} {...fieldProps("firstName", errors.firstName)} />
          </Field>
          <Field id="lastName" label="Last name" required error={errors.lastName}>
            <Input name="lastName" autoComplete="family-name" maxLength={80} value={values.lastName} onChange={(event) => setValue("lastName", event.target.value)} {...fieldProps("lastName", errors.lastName)} />
          </Field>
          <Field id="email" label="Email" required error={errors.email}>
            <Input name="email" type="email" autoComplete="email" maxLength={254} value={values.email} onChange={(event) => setValue("email", event.target.value)} {...fieldProps("email", errors.email)} />
          </Field>
          <Field id="phone" label="Phone" required error={errors.phone}>
            <Input name="phone" type="tel" autoComplete="tel" value={values.phone} onChange={(event) => setValue("phone", event.target.value)} {...fieldProps("phone", errors.phone)} />
          </Field>
          <Field id="estimatedAttendance" label="Estimated attendance" required error={errors.estimatedAttendance}>
            <Input name="estimatedAttendance" type="number" min={1} max={10000} inputMode="numeric" value={values.estimatedAttendance} onChange={(event) => setValue("estimatedAttendance", event.target.value)} {...fieldProps("estimatedAttendance", errors.estimatedAttendance)} />
          </Field>
          <Field id="purpose" label="Purpose" required error={errors.purpose} className="sm:col-span-2">
            <Textarea name="purpose" rows={3} maxLength={500} value={values.purpose} onChange={(event) => setValue("purpose", event.target.value)} {...fieldProps("purpose", errors.purpose)} />
          </Field>
          <Field id="requesterNotes" label="Anything else staff should know?" optional error={errors.requesterNotes} className="sm:col-span-2">
            <Textarea name="requesterNotes" rows={3} maxLength={1000} value={values.requesterNotes} onChange={(event) => setValue("requesterNotes", event.target.value)} {...fieldProps("requesterNotes", errors.requesterNotes)} />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-brand-gold/50 bg-brand-gold/5 p-4 sm:p-5">
        <label className="flex cursor-pointer items-start gap-3" htmlFor="legalAccepted">
          <input id="legalAccepted" name="legalAccepted" type="checkbox" checked={values.legalAccepted} onChange={(event) => setValue("legalAccepted", event.target.checked)} className="mt-1 size-5 accent-[var(--primary)]" aria-invalid={Boolean(errors.legalAccepted) || undefined} aria-describedby={errors.legalAccepted ? "legalAccepted-error" : undefined} />
          <span className="text-sm">
            I have read and accept the <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-4">Privacy Policy</Link> and <Link href="/terms" target="_blank" className="font-medium underline underline-offset-4">Terms of Service</Link>.
          </span>
        </label>
        {errors.legalAccepted ? <p id="legalAccepted-error" className="mt-2 text-sm font-medium text-destructive">{errors.legalAccepted}</p> : null}
      </section>

      {turnstileSiteKey ? (
        <div className="space-y-2">
          <TurnstileWidget key={turnstileKey} siteKey={turnstileSiteKey} onToken={setTurnstileToken} action={TURNSTILE_ACTIONS.recurringRequest} />
          {verificationNotice ? (
            <p role="alert" className="text-sm font-medium text-destructive">{verificationNotice}</p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-between">
        <Button asChild variant="outline" size="lg"><Link href="/reserve">Back to one-time reservations</Link></Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {pending ? "Sending…" : "Send recurring request"}
        </Button>
      </div>
    </form>
  );
}
