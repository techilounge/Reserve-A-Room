"use client";

import { useFormContext, useWatch } from "react-hook-form";

import { Field, fieldProps } from "@/components/forms/field";
import { CapacityWarning } from "@/components/reservations/capacity-warning";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { LIMITS, OTHER_MINISTRY, type ReservationInput } from "@/lib/validation/reservation";

import type { ReserveRoom } from "./types";

export function DetailsStep({ room, ministries }: { room: ReserveRoom | undefined; ministries: { id: string; name: string }[] }) {
  const {
    register,
    formState: { errors },
  } = useFormContext<ReservationInput>();
  const [ministryId, attendance] = useWatch<ReservationInput, ["ministryId", "estimatedAttendance"]>({
    name: ["ministryId", "estimatedAttendance"],
  });
  const estimated = Number(attendance);

  return (
    <div className="space-y-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="firstName" label="First name" required error={errors.firstName?.message}>
          <Input
            {...fieldProps("firstName", errors.firstName?.message)}
            autoComplete="given-name"
            maxLength={LIMITS.name}
            {...register("firstName")}
          />
        </Field>
        <Field id="lastName" label="Last name" required error={errors.lastName?.message}>
          <Input
            {...fieldProps("lastName", errors.lastName?.message)}
            autoComplete="family-name"
            maxLength={LIMITS.name}
            {...register("lastName")}
          />
        </Field>
        <Field id="email" label="Email" required error={errors.email?.message} description="We'll send your confirmation here.">
          <Input
            {...fieldProps("email", errors.email?.message, true)}
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={254}
            {...register("email")}
          />
        </Field>
        <Field id="phone" label="Phone" required error={errors.phone?.message}>
          <Input
            {...fieldProps("phone", errors.phone?.message)}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="(512) 555-0123"
            maxLength={30}
            {...register("phone")}
          />
        </Field>
      </div>

      <Field id="ministryId" label="Ministry or group" required error={errors.ministryId?.message}>
        <NativeSelect {...fieldProps("ministryId", errors.ministryId?.message)} {...register("ministryId")}>
          <option value="">Select a ministry or group</option>
          {ministries.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
          <option value={OTHER_MINISTRY}>Other / Not Listed</option>
        </NativeSelect>
      </Field>

      {ministryId === OTHER_MINISTRY ? (
        <Field id="otherMinistryName" label="Ministry or group name" required error={errors.otherMinistryName?.message}>
          <Input
            {...fieldProps("otherMinistryName", errors.otherMinistryName?.message)}
            maxLength={LIMITS.otherMinistry}
            {...register("otherMinistryName")}
          />
        </Field>
      ) : null}

      <Field
        id="purpose"
        label="Purpose for reservation"
        required
        error={errors.purpose?.message}
        description="For example: ministry planning meeting, choir rehearsal, Bible study, training session."
      >
        <Textarea
          {...fieldProps("purpose", errors.purpose?.message, true)}
          rows={3}
          maxLength={LIMITS.purpose}
          {...register("purpose")}
        />
      </Field>

      <Field
        id="estimatedAttendance"
        label="Estimated number of people"
        required
        error={errors.estimatedAttendance?.message}
        description={room ? `${room.name} is set up for up to ${room.capacity} people.` : undefined}
      >
        <Input
          {...fieldProps("estimatedAttendance", errors.estimatedAttendance?.message, Boolean(room))}
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITS.attendance}
          step={1}
          className="sm:max-w-40"
          {...register("estimatedAttendance")}
        />
      </Field>
      {room ? <CapacityWarning live estimated={Number.isFinite(estimated) ? estimated : 0} capacity={room.capacity} /> : null}

      <Field id="setupRequirements" label="Setup requirements" optional error={errors.setupRequirements?.message}>
        <Textarea
          {...fieldProps("setupRequirements", errors.setupRequirements?.message)}
          rows={2}
          maxLength={LIMITS.notes}
          placeholder="Tables in a U-shape, projector, etc."
          {...register("setupRequirements")}
        />
      </Field>
      <Field id="requesterNotes" label="Additional notes" optional error={errors.requesterNotes?.message}>
        <Textarea
          {...fieldProps("requesterNotes", errors.requesterNotes?.message)}
          rows={2}
          maxLength={LIMITS.notes}
          {...register("requesterNotes")}
        />
      </Field>
    </div>
  );
}
