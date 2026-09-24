/**
 * The single place where database/provider errors become user-facing messages.
 * Raw Postgres, Supabase and Resend errors are logged server-side and never shown.
 */

export type AppErrorKind =
  | "conflict"
  | "beyond_horizon"
  | "room_unavailable"
  | "too_soon"
  | "invalid_time"
  | "invalid_transition"
  | "last_super_admin"
  | "rate_limited"
  | "not_found"
  | "forbidden"
  | "validation"
  | "duplicate"
  | "in_use"
  | "unexpected";

export class AppError extends Error {
  readonly kind: AppErrorKind;

  constructor(kind: AppErrorKind, message: string) {
    super(message);
    this.name = "AppError";
    this.kind = kind;
  }
}

/** SQLSTATEs raised by our migrations (see 20260924100200_rules_and_triggers.sql). */
const SQLSTATE_KIND: Record<string, AppErrorKind> = {
  "23P01": "conflict",
  RAR01: "room_unavailable",
  RAR02: "beyond_horizon",
  RAR03: "too_soon",
  RAR04: "invalid_time",
  RAR05: "invalid_transition",
  RAR06: "last_super_admin",
  RAR07: "rate_limited",
  RAR08: "not_found",
  RAR09: "forbidden",
  RAR10: "validation",
  "23505": "duplicate",
  "23514": "validation",
  "23001": "in_use",
  "23503": "in_use",
  "42501": "forbidden",
  PGRST116: "not_found",
};

export type ErrorContext = {
  /** e.g. "4 weeks" — used for advance-booking messages. */
  advanceLimitLabel?: string;
};

export function friendlyMessage(kind: AppErrorKind, context: ErrorContext = {}): string {
  switch (kind) {
    case "conflict":
      return "That room was just reserved or requested by someone else for this time. Please select another time or room.";
    case "beyond_horizon":
      return context.advanceLimitLabel
        ? `This room may only be reserved up to ${context.advanceLimitLabel} in advance.`
        : "That date is too far in the future for this room.";
    case "room_unavailable":
      return "This room isn't available for reservations right now. Please choose another room.";
    case "too_soon":
      return "Please choose a time in the future.";
    case "invalid_time":
      return "Please choose a valid start and end time within the room's reservable hours.";
    case "invalid_transition":
      return "This reservation can no longer be changed that way. Please refresh and try again.";
    case "last_super_admin":
      return "At least one active Super Admin is required. Add another Super Admin first.";
    case "rate_limited":
      return "Too many attempts. Please wait a few minutes and try again.";
    case "not_found":
      return "We couldn't find that reservation.";
    case "forbidden":
      return "You don't have permission to do that.";
    case "validation":
      return "Please check the highlighted fields and try again.";
    case "duplicate":
      return "That name or web address is already in use. Please choose another.";
    case "in_use":
      return "This is still in use, so it can't be removed. Archive it instead.";
    case "unexpected":
      return "Something went wrong. Please try again. If the problem continues, contact the church office.";
  }
}

type ErrorLike = { code?: unknown; message?: unknown };

function isErrorLike(value: unknown): value is ErrorLike {
  return typeof value === "object" && value !== null;
}

/** Classifies any thrown value or Supabase `error` object into an AppError. */
export function toAppError(error: unknown, context: ErrorContext = {}): AppError {
  if (error instanceof AppError) return error;
  const code = isErrorLike(error) && typeof error.code === "string" ? error.code : undefined;
  const kind = (code && SQLSTATE_KIND[code]) || "unexpected";
  return new AppError(kind, friendlyMessage(kind, context));
}
