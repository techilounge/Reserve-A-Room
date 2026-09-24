import { z } from "zod";

import { APP_ROLES } from "@/lib/auth/permissions";
import { AMENITY_ICONS } from "@/lib/amenity-icons";
import { ADVANCE_MAX, ADVANCE_UNITS } from "@/lib/domain/rooms/advance-booking";

import { emailField, multiLine, singleLine } from "./text";

const uuid = z.string().regex(/^[0-9a-f-]{36}$/i, "Invalid id.");

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export const roomSchema = z
  .object({
    id: uuid.nullable(),
    name: singleLine("the room name", 100),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Use lowercase letters, numbers and dashes, like fellowship-hall.")
      .max(80),
    description: multiLine("the description", 2000, { required: false }),
    location: z.string().trim().max(200, "Please keep the location under 200 characters."),
    capacity: z.coerce.number().int("Use a whole number.").min(1, "Capacity must be at least 1.").max(10000),
    sortOrder: z.coerce.number().int().min(0).max(100000),
    active: z.boolean(),
    reservable: z.boolean(),
    unavailableMessage: z.string().trim().max(300, "Please keep the message under 300 characters."),
    approvalRequired: z.boolean(),
    foodDrinksAllowed: z.boolean(),
    useDefaultAdvance: z.boolean(),
    advanceValue: z.coerce.number().int("Use a whole number."),
    advanceUnit: z.enum(ADVANCE_UNITS),
    amenityIds: z.array(uuid).max(50),
  })
  .superRefine((room, ctx) => {
    if (!room.useDefaultAdvance) {
      const max = ADVANCE_MAX[room.advanceUnit];
      if (room.advanceValue < 1 || room.advanceValue > max) {
        ctx.addIssue({ code: "custom", path: ["advanceValue"], message: `Choose between 1 and ${max} ${room.advanceUnit}s.` });
      }
    }
  });
export type RoomInput = z.input<typeof roomSchema>;

export const amenitySchema = z.object({
  name: singleLine("the amenity name", 60),
  icon: z.enum(Object.keys(AMENITY_ICONS) as [string, ...string[]]).or(z.literal("")),
});

export const ministrySchema = z.object({
  id: uuid.nullable(),
  name: singleLine("the ministry name", 120),
  active: z.boolean(),
  sortOrder: z.coerce.number().int().min(0).max(100000),
});

export const inviteSchema = z.object({
  fullName: singleLine("their name", 120),
  email: emailField,
  role: z.enum(APP_ROLES),
});

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a time like 06:00.");

export const settingsSchema = z
  .object({
    churchName: singleLine("the church name", 200),
    appName: singleLine("the application name", 100),
    timezone: z.string().refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Choose a valid timezone."),
    contactEmail: z.string().trim().toLowerCase().pipe(z.email({ error: "Enter a valid email address." }).or(z.literal(""))),
    contactPhone: z.string().trim().max(40),
    bookingIntervalMinutes: z.coerce.number().refine((n) => [15, 30, 60].includes(n), "Choose 15, 30 or 60 minutes."),
    defaultAdvanceValue: z.coerce.number().int(),
    defaultAdvanceUnit: z.enum(ADVANCE_UNITS),
    minLeadTimeMinutes: z.coerce.number().int().min(0, "Can't be negative.").max(10080, "At most 7 days (10080 minutes)."),
    bookableDayStart: time,
    bookableDayEnd: time,
    allowGuestCancellation: z.boolean(),
    extraRecipients: z
      .string()
      .transform((v) => v.split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean))
      .pipe(z.array(z.email({ error: "One of the notification emails isn't valid." })).max(10, "Up to 10 extra recipients.")),
    emailSenderName: singleLine("the sender name", 100),
  })
  .superRefine((s, ctx) => {
    const max = ADVANCE_MAX[s.defaultAdvanceUnit];
    if (s.defaultAdvanceValue < 1 || s.defaultAdvanceValue > max) {
      ctx.addIssue({ code: "custom", path: ["defaultAdvanceValue"], message: `Choose between 1 and ${max} ${s.defaultAdvanceUnit}s.` });
    }
    if (s.bookableDayStart >= s.bookableDayEnd) {
      ctx.addIssue({ code: "custom", path: ["bookableDayEnd"], message: "The end of the day must be after the start." });
    }
  });
export type SettingsInput = z.input<typeof settingsSchema>;
