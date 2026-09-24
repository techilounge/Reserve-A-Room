"use client";

import { LoaderCircle, TriangleAlert } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateSettingsAction } from "@/app/admin/(portal)/(super)/actions";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import type { SettingsInput } from "@/lib/validation/super";

export function SettingsForm({ initial, timezones }: { initial: SettingsInput; timezones: string[] }) {
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const set = <K extends keyof SettingsInput>(key: K, value: SettingsInput[K]) => setForm((f) => ({ ...f, [key]: value }));
  const text = (key: keyof SettingsInput) => String(form[key] ?? "");

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        setErrors({});
        startTransition(async () => {
          const result = await updateSettingsAction(form);
          if (result.ok) toast.success(result.message);
          else {
            toast.error(result.message);
            setErrors(result.fieldErrors ?? {});
          }
        });
      }}
      className="flex flex-col gap-6"
    >
      <section aria-labelledby="church-heading" className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-6">
        <h2 id="church-heading" className="text-lg font-semibold sm:col-span-2">
          Church
        </h2>
        <Field id="churchName" label="Church name" required error={errors.churchName}>
          <Input id="churchName" value={text("churchName")} onChange={(e) => set("churchName", e.target.value)} />
        </Field>
        <Field id="appName" label="Application name" required error={errors.appName}>
          <Input id="appName" value={text("appName")} onChange={(e) => set("appName", e.target.value)} />
        </Field>
        <Field id="contactEmail" label="Contact email" optional error={errors.contactEmail} description="Shown to guests and in emails.">
          <Input id="contactEmail" type="email" value={text("contactEmail")} onChange={(e) => set("contactEmail", e.target.value)} />
        </Field>
        <Field id="contactPhone" label="Contact phone" optional error={errors.contactPhone}>
          <Input id="contactPhone" type="tel" value={text("contactPhone")} onChange={(e) => set("contactPhone", e.target.value)} />
        </Field>
        <Field id="timezone" label="Timezone" required error={errors.timezone} className="sm:col-span-2">
          <NativeSelect id="timezone" value={text("timezone")} onChange={(e) => set("timezone", e.target.value)}>
            {timezones.map((tz) => (
              <option key={tz} value={tz}>
                {tz.replace(/_/g, " ")}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {form.timezone !== initial.timezone ? (
          <p className="flex gap-2 rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning-soft-foreground sm:col-span-2">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            Existing reservations keep their exact moment in time, so they will display at different local times after this
            change. Only change the timezone if the church has moved.
          </p>
        ) : null}
      </section>

      <section aria-labelledby="booking-heading" className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-6">
        <h2 id="booking-heading" className="text-lg font-semibold sm:col-span-2">
          Booking rules
        </h2>
        <Field id="bookableDayStart" label="Reservations may start from" required error={errors.bookableDayStart}>
          <Input id="bookableDayStart" type="time" step={900} value={text("bookableDayStart")} onChange={(e) => set("bookableDayStart", e.target.value)} />
        </Field>
        <Field id="bookableDayEnd" label="Reservations must end by" required error={errors.bookableDayEnd}>
          <Input id="bookableDayEnd" type="time" step={900} value={text("bookableDayEnd")} onChange={(e) => set("bookableDayEnd", e.target.value)} />
        </Field>
        <Field id="bookingIntervalMinutes" label="Time increments" required error={errors.bookingIntervalMinutes}>
          <NativeSelect id="bookingIntervalMinutes" value={text("bookingIntervalMinutes")} onChange={(e) => set("bookingIntervalMinutes", e.target.value)}>
            <option value="15">Every 15 minutes</option>
            <option value="30">Every 30 minutes</option>
            <option value="60">Every hour</option>
          </NativeSelect>
        </Field>
        <Field
          id="minLeadTimeMinutes"
          label="Minimum notice (minutes)"
          required
          error={errors.minLeadTimeMinutes}
          description="0 allows any future time. 1440 = one day."
        >
          <Input id="minLeadTimeMinutes" type="number" inputMode="numeric" min={0} max={10080} value={text("minLeadTimeMinutes")} onChange={(e) => set("minLeadTimeMinutes", e.target.value)} />
        </Field>
        <fieldset className="space-y-1.5 sm:col-span-2">
          <legend className="text-sm font-medium">Default maximum advance reservation</legend>
          <p className="text-sm text-muted-foreground">Used by rooms that don&apos;t set their own limit.</p>
          <div className="flex flex-wrap gap-2">
            <Input
              aria-label="Number"
              className="w-24"
              type="number"
              inputMode="numeric"
              min={1}
              value={text("defaultAdvanceValue")}
              aria-invalid={Boolean(errors.defaultAdvanceValue) || undefined}
              onChange={(e) => set("defaultAdvanceValue", e.target.value)}
            />
            <NativeSelect aria-label="Unit" className="w-36" value={text("defaultAdvanceUnit")} onChange={(e) => set("defaultAdvanceUnit", e.target.value as SettingsInput["defaultAdvanceUnit"])}>
              <option value="day">Days</option>
              <option value="week">Weeks</option>
              <option value="month">Months</option>
            </NativeSelect>
          </div>
          {errors.defaultAdvanceValue ? <p className="text-sm font-medium text-destructive">{errors.defaultAdvanceValue}</p> : null}
        </fieldset>
        <label className="flex items-start gap-3 sm:col-span-2">
          <input
            type="checkbox"
            checked={Boolean(form.allowGuestCancellation)}
            onChange={(e) => set("allowGuestCancellation", e.target.checked)}
            className="mt-0.5 size-5 accent-[var(--primary)]"
          />
          <span>
            <span className="block font-medium">Allow guests to cancel online</span>
            <span className="block text-sm text-muted-foreground">Guests can cancel from their reservation link until it starts.</span>
          </span>
        </label>
      </section>

      <section aria-labelledby="email-heading" className="grid gap-4 rounded-xl border bg-card p-4 sm:grid-cols-2 sm:p-6">
        <h2 id="email-heading" className="text-lg font-semibold sm:col-span-2">
          Email
        </h2>
        <Field id="emailSenderName" label="Sender display name" required error={errors.emailSenderName}>
          <Input id="emailSenderName" value={text("emailSenderName")} onChange={(e) => set("emailSenderName", e.target.value)} />
        </Field>
        <Field
          id="extraRecipients"
          label="Extra notification recipients"
          optional
          error={errors.extraRecipients}
          description="New request and cancellation emails also go to these addresses (e.g. the church office). Separate with commas. Admins who opted in always receive them."
          className="sm:col-span-2"
        >
          <Textarea id="extraRecipients" rows={2} value={text("extraRecipients")} onChange={(e) => set("extraRecipients", e.target.value)} />
        </Field>
      </section>

      <div className="flex justify-end">
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {pending ? "Saving…" : "Save settings"}
        </Button>
      </div>
    </form>
  );
}
