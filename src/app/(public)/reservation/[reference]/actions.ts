"use server";

import { revalidatePath } from "next/cache";

import { cancelGuestReservation } from "@/lib/reservations/guest-access";

export type CancelState = { status: "idle" | "error" | "cancelled"; message?: string };

export async function cancelReservationAction(reference: string): Promise<CancelState> {
  const result = await cancelGuestReservation(reference);
  if (!result.ok) {
    return {
      status: "error",
      message:
        result.error.kind === "forbidden"
          ? "Online cancellation isn't available. Please contact the church office to cancel."
          : result.error.kind === "invalid_transition"
            ? "This reservation can no longer be cancelled online."
            : result.error.message,
    };
  }
  revalidatePath(`/reservation/${reference}`);
  return { status: "cancelled" };
}
