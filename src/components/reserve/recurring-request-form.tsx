"use client";

import { CalendarCheck, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useActionState, useState } from "react";

import { submitRecurringRequest, type RecurringRequestState } from "@/app/(public)/recurring-request/actions";
import { Field, fieldProps } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

const INITIAL: RecurringRequestState = { status: "idle" };

export function RecurringRequestForm({ rooms, today }: { rooms: { id: string; name: string }[]; today: string }) {
  const [state, action, pending] = useActionState(submitRecurringRequest, INITIAL);
  const [startedAt] = useState(() => Date.now());
  const errors = state.fieldErrors ?? {};

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
    <form action={action} className="space-y-6" noValidate>
      <input type="hidden" name="startedAt" value={startedAt} />
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
          <NativeSelect name="roomId" defaultValue="" {...fieldProps("roomId", errors.roomId)}>
            <option value="" disabled>Choose a room</option>
            {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
          </NativeSelect>
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="preferredStartDate" label="Preferred start date" required error={errors.preferredStartDate}>
            <Input name="preferredStartDate" type="date" min={today} {...fieldProps("preferredStartDate", errors.preferredStartDate)} />
          </Field>
          <Field id="start" label="Start time" required error={errors.start}>
            <Input name="start" type="time" {...fieldProps("start", errors.start)} />
          </Field>
          <Field id="end" label="End time" required error={errors.end}>
            <Input name="end" type="time" {...fieldProps("end", errors.end)} />
          </Field>
        </div>
        <Field
          id="recurrenceDescription"
          label="How should it repeat?"
          required
          error={errors.recurrenceDescription}
          description="For example: the second and fourth Saturday of every month through May 2027."
        >
          <Textarea name="recurrenceDescription" rows={3} maxLength={1000} placeholder="Describe the dates or repeating pattern" {...fieldProps("recurrenceDescription", errors.recurrenceDescription, true)} />
        </Field>
      </section>

      <section className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <h2 className="text-lg font-semibold">Your details</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="firstName" label="First name" required error={errors.firstName}>
            <Input name="firstName" autoComplete="given-name" maxLength={80} {...fieldProps("firstName", errors.firstName)} />
          </Field>
          <Field id="lastName" label="Last name" required error={errors.lastName}>
            <Input name="lastName" autoComplete="family-name" maxLength={80} {...fieldProps("lastName", errors.lastName)} />
          </Field>
          <Field id="email" label="Email" required error={errors.email}>
            <Input name="email" type="email" autoComplete="email" maxLength={254} {...fieldProps("email", errors.email)} />
          </Field>
          <Field id="phone" label="Phone" required error={errors.phone}>
            <Input name="phone" type="tel" autoComplete="tel" {...fieldProps("phone", errors.phone)} />
          </Field>
          <Field id="estimatedAttendance" label="Estimated attendance" required error={errors.estimatedAttendance}>
            <Input name="estimatedAttendance" type="number" min={1} max={10000} inputMode="numeric" {...fieldProps("estimatedAttendance", errors.estimatedAttendance)} />
          </Field>
          <Field id="purpose" label="Purpose" required error={errors.purpose} className="sm:col-span-2">
            <Textarea name="purpose" rows={3} maxLength={500} {...fieldProps("purpose", errors.purpose)} />
          </Field>
          <Field id="requesterNotes" label="Anything else staff should know?" optional error={errors.requesterNotes} className="sm:col-span-2">
            <Textarea name="requesterNotes" rows={3} maxLength={1000} {...fieldProps("requesterNotes", errors.requesterNotes)} />
          </Field>
        </div>
      </section>

      <section className="rounded-xl border border-brand-gold/50 bg-brand-gold/5 p-4 sm:p-5">
        <label className="flex cursor-pointer items-start gap-3" htmlFor="legalAccepted">
          <input id="legalAccepted" name="legalAccepted" type="checkbox" className="mt-1 size-5 accent-[var(--primary)]" aria-invalid={Boolean(errors.legalAccepted) || undefined} aria-describedby={errors.legalAccepted ? "legalAccepted-error" : undefined} />
          <span className="text-sm">
            I have read and accept the <Link href="/privacy" target="_blank" className="font-medium underline underline-offset-4">Privacy Policy</Link> and <Link href="/terms" target="_blank" className="font-medium underline underline-offset-4">Terms of Service</Link>.
          </span>
        </label>
        {errors.legalAccepted ? <p id="legalAccepted-error" className="mt-2 text-sm font-medium text-destructive">{errors.legalAccepted}</p> : null}
      </section>

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
