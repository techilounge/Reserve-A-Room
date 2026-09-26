import { z } from "zod";

import { isLocalDate, isLocalTime, minutesOfDay } from "@/lib/datetime";
import { LEGAL_ACCEPTANCE_MESSAGE } from "@/lib/legal";

import { emailField, multiLine, phoneField, singleLine } from "./text";

export const recurringRequestSchema = z
  .object({
    roomId: z.uuid({ error: "Please choose a room." }),
    preferredStartDate: z.string().refine(isLocalDate, "Please choose a preferred start date."),
    start: z.string().refine(isLocalTime, "Please choose a start time."),
    end: z.string().refine(isLocalTime, "Please choose an end time."),
    recurrenceDescription: multiLine("the repeating schedule", 1000),
    firstName: singleLine("your first name", 80),
    lastName: singleLine("your last name", 80),
    email: emailField,
    phone: phoneField,
    purpose: multiLine("the purpose of your reservation", 500),
    estimatedAttendance: z.coerce
      .number({ error: "Please enter how many people will attend." })
      .int("Please enter a whole number.")
      .min(1, "Please enter at least 1 person.")
      .max(10000, "Please enter a number up to 10,000."),
    requesterNotes: multiLine("notes", 1000, { required: false }).optional(),
    legalAccepted: z.boolean().refine(Boolean, LEGAL_ACCEPTANCE_MESSAGE),
  })
  .superRefine((value, context) => {
    if (isLocalTime(value.start) && isLocalTime(value.end) && minutesOfDay(value.end) <= minutesOfDay(value.start)) {
      context.addIssue({ code: "custom", path: ["end"], message: "The end time must be after the start time." });
    }
  })
  .transform((value) => ({ ...value, requesterNotes: value.requesterNotes || undefined }));

export type RecurringRequestInput = z.input<typeof recurringRequestSchema>;
