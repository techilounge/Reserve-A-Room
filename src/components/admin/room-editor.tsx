"use client";

import { Info, LoaderCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { createAmenityAction, saveRoomAction } from "@/app/admin/(portal)/(super)/actions";
import { Field } from "@/components/forms/field";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { AMENITY_ICONS, amenityIcon } from "@/lib/amenity-icons";
import { ADVANCE_MAX, advanceLabel, type AdvanceRule, type AdvanceUnit } from "@/lib/domain/rooms/advance-booking";
import { roomPolicySummary } from "@/lib/domain/rooms/policy";
import { cn } from "@/lib/utils";
import { slugify, type RoomInput } from "@/lib/validation/super";

export type EditableRoom = {
  id: string | null;
  name: string;
  slug: string;
  description: string;
  location: string;
  capacity: number;
  sortOrder: number;
  active: boolean;
  reservable: boolean;
  unavailableMessage: string;
  approvalRequired: boolean;
  foodDrinksAllowed: boolean;
  advance: AdvanceRule | null;
  amenityIds: string[];
};

type Amenity = { id: string; name: string; icon: string | null; active: boolean };

function Choice({
  name,
  checked,
  onChange,
  title,
  description,
}: {
  name: string;
  checked: boolean;
  onChange: () => void;
  title: string;
  description: string;
}) {
  return (
    <label
      className={cn(
        "flex cursor-pointer gap-3 rounded-lg border p-3 has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
        checked && "border-primary bg-accent",
      )}
    >
      <input type="radio" name={name} checked={checked} onChange={onChange} className="mt-1 size-4 accent-[var(--primary)]" />
      <span>
        <span className="block font-medium">{title}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  label: string;
  description: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 size-5 accent-[var(--primary)]" />
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-sm text-muted-foreground">{description}</span>
      </span>
    </label>
  );
}

export function RoomEditor({
  room,
  amenities: initialAmenities,
  defaultAdvance,
}: {
  room: EditableRoom;
  amenities: Amenity[];
  defaultAdvance: AdvanceRule;
}) {
  const creating = room.id === null;
  const [form, setForm] = useState({
    ...room,
    capacity: String(room.capacity),
    sortOrder: String(room.sortOrder),
    useDefaultAdvance: room.advance === null,
    advanceValue: String(room.advance?.value ?? defaultAdvance.value),
    advanceUnit: (room.advance?.unit ?? defaultAdvance.unit) as AdvanceUnit,
  });
  const [slugTouched, setSlugTouched] = useState(!creating);
  const [amenities, setAmenities] = useState(initialAmenities);
  const [newAmenity, setNewAmenity] = useState({ name: "", icon: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [addingAmenity, startAmenity] = useTransition();

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));
  const advance: AdvanceRule = form.useDefaultAdvance
    ? defaultAdvance
    : { value: Number(form.advanceValue) || 1, unit: form.advanceUnit };
  const summary = roomPolicySummary({
    capacity: Number(form.capacity) || 0,
    approvalRequired: form.approvalRequired,
    foodDrinksAllowed: form.foodDrinksAllowed,
    advance,
  });

  function save() {
    setFormError(null);
    setErrors({});
    const payload: RoomInput = {
      id: form.id,
      name: form.name,
      slug: form.slug,
      description: form.description,
      location: form.location,
      capacity: form.capacity,
      sortOrder: form.sortOrder,
      active: form.active,
      reservable: form.reservable,
      unavailableMessage: form.unavailableMessage,
      approvalRequired: form.approvalRequired,
      foodDrinksAllowed: form.foodDrinksAllowed,
      useDefaultAdvance: form.useDefaultAdvance,
      advanceValue: form.advanceValue,
      advanceUnit: form.advanceUnit,
      amenityIds: form.amenityIds,
    };
    startTransition(async () => {
      const result = await saveRoomAction(payload);
      if (!result) return;
      if (!result.ok) {
        setFormError(result.message);
        setErrors(result.fieldErrors ?? {});
        return;
      }
      toast.success(result.message);
    });
  }

  function addAmenity() {
    startAmenity(async () => {
      const result = await createAmenityAction(newAmenity);
      if (!result.ok || !result.id) {
        toast.error(result.message);
        return;
      }
      const id = result.id;
      setAmenities((list) => [...list, { id, name: newAmenity.name.trim(), icon: newAmenity.icon || null, active: true }]);
      setForm((f) => ({ ...f, amenityIds: [...f.amenityIds, id] }));
      setNewAmenity({ name: "", icon: "" });
      toast.success("Amenity added.");
    });
  }

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        save();
      }}
      className="flex flex-col gap-6"
    >
      {formError ? (
        <p role="alert" className="rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger-soft-foreground">
          {formError}
        </p>
      ) : null}

      <section aria-labelledby="basics-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <h2 id="basics-heading" className="text-lg font-semibold">
          Basic information
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="name" label="Room name" required error={errors.name}>
            <Input
              id="name"
              value={form.name}
              maxLength={100}
              aria-invalid={Boolean(errors.name) || undefined}
              onChange={(e) => {
                set("name", e.target.value);
                if (!slugTouched) set("slug", slugify(e.target.value));
              }}
            />
          </Field>
          <Field id="slug" label="Web address" required error={errors.slug} description={`/rooms/${form.slug || "…"}`}>
            <Input
              id="slug"
              value={form.slug}
              maxLength={80}
              aria-invalid={Boolean(errors.slug) || undefined}
              onChange={(e) => {
                setSlugTouched(true);
                set("slug", e.target.value.toLowerCase());
              }}
            />
          </Field>
          <Field id="capacity" label="Capacity (people)" required error={errors.capacity}>
            <Input id="capacity" type="number" inputMode="numeric" min={1} value={form.capacity} onChange={(e) => set("capacity", e.target.value)} />
          </Field>
          <Field id="location" label="Location" optional error={errors.location}>
            <Input id="location" value={form.location} maxLength={200} placeholder="e.g. Main building, lower level" onChange={(e) => set("location", e.target.value)} />
          </Field>
          <Field id="description" label="Description" optional error={errors.description} className="sm:col-span-2">
            <Textarea id="description" rows={3} maxLength={2000} value={form.description} onChange={(e) => set("description", e.target.value)} />
          </Field>
          <Field id="sortOrder" label="Display order" description="Lower numbers are listed first." error={errors.sortOrder}>
            <Input id="sortOrder" type="number" inputMode="numeric" min={0} value={form.sortOrder} onChange={(e) => set("sortOrder", e.target.value)} />
          </Field>
        </div>
      </section>

      <section aria-labelledby="amenities-heading" className="space-y-4 rounded-xl border bg-card p-4 sm:p-6">
        <h2 id="amenities-heading" className="text-lg font-semibold">
          Amenities
        </h2>
        <fieldset>
          <legend className="sr-only">Amenities available in this room</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {amenities
              .filter((a) => a.active || form.amenityIds.includes(a.id))
              .map((a) => {
                const Icon = amenityIcon(a.icon);
                const checked = form.amenityIds.includes(a.id);
                return (
                  <label key={a.id} className={cn("flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border px-3", checked && "border-primary bg-accent")}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(e) =>
                        set("amenityIds", e.target.checked ? [...form.amenityIds, a.id] : form.amenityIds.filter((id) => id !== a.id))
                      }
                      className="size-4 accent-[var(--primary)]"
                    />
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    <span className="text-sm">{a.name}</span>
                  </label>
                );
              })}
          </div>
        </fieldset>
        <div className="flex flex-col gap-2 rounded-lg border border-dashed p-3 sm:flex-row sm:items-end">
          <div className="flex-1 space-y-1">
            <Label htmlFor="new-amenity">Add an amenity</Label>
            <Input id="new-amenity" value={newAmenity.name} maxLength={60} placeholder="e.g. Microphone" onChange={(e) => setNewAmenity((n) => ({ ...n, name: e.target.value }))} />
          </div>
          <div className="space-y-1 sm:w-44">
            <Label htmlFor="new-amenity-icon">Icon</Label>
            <NativeSelect id="new-amenity-icon" value={newAmenity.icon} onChange={(e) => setNewAmenity((n) => ({ ...n, icon: e.target.value }))}>
              <option value="">Checkmark</option>
              {Object.keys(AMENITY_ICONS).map((key) => (
                <option key={key} value={key}>
                  {key.replace(/-/g, " ")}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="button" variant="secondary" onClick={addAmenity} disabled={addingAmenity || !newAmenity.name.trim()}>
            {addingAmenity ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus data-icon="inline-start" aria-hidden />}
            Add
          </Button>
        </div>
      </section>

      <section aria-labelledby="rules-heading" className="space-y-5 rounded-xl border bg-card p-4 sm:p-6">
        <h2 id="rules-heading" className="text-lg font-semibold">
          Reservation rules
        </h2>

        <div className="space-y-3">
          <Toggle
            id="active"
            checked={form.active}
            onChange={(v) => set("active", v)}
            label="Active"
            description="Inactive (archived) rooms are hidden everywhere. Their reservation history is kept."
          />
          <Toggle
            id="reservable"
            checked={form.reservable}
            onChange={(v) => set("reservable", v)}
            label="Open for reservations"
            description="Turn off to mark the room temporarily unavailable. It stays visible with a notice."
          />
          {!form.reservable ? (
            <Field id="unavailableMessage" label="Message shown to guests" optional error={errors.unavailableMessage}>
              <Input
                id="unavailableMessage"
                value={form.unavailableMessage}
                maxLength={300}
                placeholder="e.g. Closed for renovation until November."
                onChange={(e) => set("unavailableMessage", e.target.value)}
              />
            </Field>
          ) : null}
        </div>

        <fieldset className="space-y-2">
          <legend className="mb-1 font-medium">Approval</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice
              name="approval"
              checked={form.approvalRequired}
              onChange={() => set("approvalRequired", true)}
              title="Approval Required"
              description="Requests are Pending until an Admin approves them."
            />
            <Choice
              name="approval"
              checked={!form.approvalRequired}
              onChange={() => set("approvalRequired", false)}
              title="Instant Reservation"
              description="Available times are confirmed immediately."
            />
          </div>
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 font-medium">Maximum advance reservation</legend>
          <Toggle
            id="useDefaultAdvance"
            checked={form.useDefaultAdvance}
            onChange={(v) => set("useDefaultAdvance", v)}
            label={`Use the application default (${advanceLabel(defaultAdvance)})`}
            description="Change the default in Settings."
          />
          {!form.useDefaultAdvance ? (
            <div className="flex flex-wrap items-end gap-2">
              <div className="w-24 space-y-1">
                <Label htmlFor="advanceValue">Number</Label>
                <Input
                  id="advanceValue"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={ADVANCE_MAX[form.advanceUnit]}
                  value={form.advanceValue}
                  aria-invalid={Boolean(errors.advanceValue) || undefined}
                  aria-describedby={errors.advanceValue ? "advanceValue-error" : undefined}
                  onChange={(e) => set("advanceValue", e.target.value)}
                />
              </div>
              <div className="w-36 space-y-1">
                <Label htmlFor="advanceUnit">Unit</Label>
                <NativeSelect id="advanceUnit" value={form.advanceUnit} onChange={(e) => set("advanceUnit", e.target.value as AdvanceUnit)}>
                  <option value="day">Days</option>
                  <option value="week">Weeks</option>
                  <option value="month">Months</option>
                </NativeSelect>
              </div>
              {errors.advanceValue ? (
                <p id="advanceValue-error" className="w-full text-sm font-medium text-destructive">
                  {errors.advanceValue}
                </p>
              ) : null}
            </div>
          ) : null}
        </fieldset>

        <fieldset className="space-y-2">
          <legend className="mb-1 font-medium">Food and drinks</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice name="food" checked={form.foodDrinksAllowed} onChange={() => set("foodDrinksAllowed", true)} title="Allowed" description="Guests may bring food and drinks." />
            <Choice name="food" checked={!form.foodDrinksAllowed} onChange={() => set("foodDrinksAllowed", false)} title="Not Allowed" description="Food and drinks are not permitted." />
          </div>
        </fieldset>

        <div role="status" aria-live="polite" className="flex gap-3 rounded-lg border border-info-border bg-info-soft p-4 text-sm text-info-soft-foreground">
          <Info className="mt-0.5 size-5 shrink-0" aria-hidden />
          <div>
            <p className="font-semibold">Summary</p>
            <p>
              {summary}
              {!form.active ? " This room is archived and hidden." : !form.reservable ? " It is currently closed for reservations." : ""}
            </p>
          </div>
        </div>
        {!creating ? (
          <p className="text-sm text-muted-foreground">
            Changes apply to new reservations and rescheduling. Existing reservations keep the policies they were booked with.
          </p>
        ) : null}
      </section>

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
        <Button asChild variant="outline" size="lg">
          <Link href="/admin/rooms">Back to rooms</Link>
        </Button>
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {pending ? "Saving…" : creating ? "Create room" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}
