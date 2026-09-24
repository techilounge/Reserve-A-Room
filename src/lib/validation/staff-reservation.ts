import { z } from "zod";

import { multiLine } from "./text";
import { reservationSchema } from "./reservation";

/** Staff create/edit: the guest fields plus private notes and a notify choice. */
export const staffReservationSchema = z.object({
  reservation: reservationSchema,
  adminNotes: multiLine("private notes", 4000, { required: false }).optional(),
  notify: z.boolean().default(true),
});

export type StaffReservationInput = z.input<typeof staffReservationSchema>;

export const staffMessageSchema = z.object({
  message: multiLine("the message", 1000, { required: false }).optional(),
  adminNote: multiLine("the private note", 4000, { required: false }).optional(),
});
