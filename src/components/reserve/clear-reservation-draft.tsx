"use client";

import { useEffect } from "react";

import { clearReservationDraft } from "@/lib/drafts/reservation-draft";
import { browserStorage } from "@/lib/drafts/storage";

/** Rendered on the confirmation page: a submitted reservation no longer needs its saved draft. */
export function ClearReservationDraft() {
  useEffect(() => {
    const storage = browserStorage();
    if (storage) clearReservationDraft(storage);
  }, []);
  return null;
}
