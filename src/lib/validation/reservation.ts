import { z } from "zod";

import { isLocalDate, isLocalTime, minutesOfDay } from "@/lib/datetime";
import { LEGAL_ACCEPTANCE_MESSAGE } from "@/lib/legal";

import { emailField, multiLine, phoneField, singleLine } from "./text";

/** The value used by the ministry select for "Other / Not Listed". */
export const OTHER_MINISTRY = "other";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const LIMITS = {
  name: 80,
  otherMinistry: 120,
  purpose: 500,
  notes: 1000,
  attendance: 10000,
} as const;

/**
 * Guest reservation input — shared by the browser form (instant feedback) and the
 * server action (the real check). The database enforces its own constraints again.
 */
export const reservationSchema = z
  .object({
    roomId: z.uuid({ error: "Please choose a room." }),
    date: z.string({ error: "Please choose a date." }).refine(isLocalDate, "Please choose a date."),
    start: z.string({ error: "Please choose a start time." }).refine(isLocalTime, "Please choose a start time."),
    end: z.string({ error: "Please choose an end time." }).refine(isLocalTime, "Please choose an end time."),

    firstName: singleLine("your first name", LIMITS.name),
    lastName: singleLine("your last name", LIMITS.name),
    email: emailField,
    phone: phoneField,
    ministryId: z
      .string({ error: "Please choose your ministry or group." })
      .refine((v) => v === OTHER_MINISTRY || UUID.test(v), "Please choose your ministry or group."),
    otherMinistryName: z.string().optional(),
    purpose: multiLine("the purpose of your reservation", LIMITS.purpose),
    estimatedAttendance: z.preprocess(
      (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
      z.coerce
        .number({ error: "Please enter how many people will attend." })
        .int("Please enter a whole number.")
        .min(1, "Please enter at least 1 person.")
        .max(LIMITS.attendance, `Please enter a number up to ${LIMITS.attendance}.`),
    ),
    setupRequirements: multiLine("setup requirements", LIMITS.notes, { required: false }).optional(),
    requesterNotes: multiLine("notes", LIMITS.notes, { required: false }).optional(),
    legalAccepted: z.boolean().refine((accepted) => accepted, LEGAL_ACCEPTANCE_MESSAGE),
  })
  .superRefine((value, ctx) => {
    if (isLocalTime(value.start) && isLocalTime(value.end) && minutesOfDay(value.end) <= minutesOfDay(value.start)) {
      ctx.addIssue({ code: "custom", path: ["end"], message: "The end time must be after the start time." });
    }
    if (value.ministryId === OTHER_MINISTRY) {
      const name = (value.otherMinistryName ?? "").replace(/\s+/g, " ").trim();
      if (!name) {
        ctx.addIssue({ code: "custom", path: ["otherMinistryName"], message: "Please enter your ministry or group name." });
      } else if (name.length > LIMITS.otherMinistry) {
        ctx.addIssue({
          code: "custom",
          path: ["otherMinistryName"],
          message: `Please keep the name under ${LIMITS.otherMinistry} characters.`,
        });
      }
    }
  })
  .transform((value) => ({
    ...value,
    otherMinistryName:
      value.ministryId === OTHER_MINISTRY ? (value.otherMinistryName ?? "").replace(/\s+/g, " ").trim() : undefined,
    setupRequirements: value.setupRequirements || undefined,
    requesterNotes: value.requesterNotes || undefined,
  }));

export type ReservationInput = z.input<typeof reservationSchema>;
export type ReservationValues = z.output<typeof reservationSchema>;

/** Fields validated on each step of the guest form. */
export const STEP_FIELDS = {
  schedule: ["roomId", "date", "start", "end"],
  details: [
    "firstName",
    "lastName",
    "email",
    "phone",
    "ministryId",
    "otherMinistryName",
    "purpose",
    "estimatedAttendance",
    "setupRequirements",
    "requesterNotes",
  ],
  review: ["legalAccepted"],
} as const satisfies Record<string, readonly (keyof ReservationInput)[]>;

/** Flattens Zod issues to { field: firstMessage } for the form. */
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "form");
    out[key] ??= issue.message;
  }
  return out;
}
