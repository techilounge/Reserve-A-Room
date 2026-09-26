import { z } from "zod";

import { addMonthsToLocalDate, compareLocalDates, isLocalDate } from "@/lib/datetime";
import { MAX_RECURRENCE_MONTHS } from "@/lib/recurrence/types";

import { multiLine } from "./text";
import { reservationSchema } from "./reservation";

const optionalDate = z.preprocess(
  (value) => (value === "" || value == null ? undefined : value),
  z.string().refine(isLocalDate, "Please choose a valid end date.").optional(),
);

export const staffRecurrenceSchema = z.discriminatedUnion("frequency", [
  z.object({ frequency: z.literal("none") }),
  z.object({ frequency: z.literal("daily"), interval: z.number().int().min(1).max(365), endDate: optionalDate }),
  z.object({ frequency: z.literal("weekdays"), endDate: optionalDate }),
  z.object({
    frequency: z.literal("weekly"),
    interval: z.number().int().min(1).max(52),
    weekdays: z
      .array(z.number().int().min(0).max(6))
      .min(1, "Choose at least one weekday.")
      .max(7)
      .refine((days) => new Set(days).size === days.length, "Choose each weekday only once."),
    endDate: optionalDate,
  }),
  z.object({
    frequency: z.literal("monthly_day"),
    interval: z.number().int().min(1).max(12),
    dayOfMonth: z.number().int().min(1).max(31),
    endDate: optionalDate,
  }),
  z.object({
    frequency: z.literal("monthly_nth_weekday"),
    interval: z.number().int().min(1).max(12),
    weekday: z.number().int().min(0).max(6),
    ordinals: z
      .array(z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]))
      .min(1, "Choose at least one week of the month.")
      .max(5)
      .refine((values) => new Set(values).size === values.length, "Choose each week of the month only once."),
    endDate: optionalDate,
  }),
  z.object({
    frequency: z.literal("yearly_date"),
    month: z.number().int().min(1).max(12),
    dayOfMonth: z.number().int().min(1).max(31),
    endDate: optionalDate,
  }),
  z.object({
    frequency: z.literal("yearly_nth_weekday"),
    month: z.number().int().min(1).max(12),
    weekday: z.number().int().min(0).max(6),
    ordinal: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(-1)]),
    endDate: optionalDate,
  }),
]);

/** Staff create/edit: the guest fields plus private notes and a notify choice. */
export const staffReservationSchema = z
  .object({
    reservation: reservationSchema,
    recurrence: staffRecurrenceSchema.default({ frequency: "none" }),
    adminNotes: multiLine("private notes", 4000, { required: false }).optional(),
    notify: z.boolean().default(true),
  })
  .superRefine((value, ctx) => {
    const recurrence = value.recurrence;
    if (recurrence.frequency === "none" || !recurrence.endDate || !isLocalDate(value.reservation.date)) return;
    if (compareLocalDates(recurrence.endDate, value.reservation.date) < 0) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrence", "endDate"],
        message: "The end date cannot be before the start date.",
      });
    } else if (
      compareLocalDates(recurrence.endDate, addMonthsToLocalDate(value.reservation.date, MAX_RECURRENCE_MONTHS)) > 0
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrence", "endDate"],
        message: "A recurring series may span at most 1 year.",
      });
    }
  });

export type StaffReservationInput = z.input<typeof staffReservationSchema>;
export type StaffRecurrenceInput = z.input<typeof staffRecurrenceSchema>;

export const staffMessageSchema = z.object({
  message: multiLine("the message", 1000, { required: false }).optional(),
  adminNote: multiLine("the private note", 4000, { required: false }).optional(),
});
