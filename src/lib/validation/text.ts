import { parsePhoneNumberFromString } from "libphonenumber-js/min";
import { z } from "zod";

// Control characters (except tab/newline) never belong in form input.
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F​-‍⁠﻿]/g;

/** Trims and collapses whitespace; for names and other one-line fields. */
export function cleanSingleLine(value: string): string {
  return value.replace(CONTROL_CHARS, "").replace(/\s+/g, " ").trim();
}

/** Keeps line breaks (max one blank line), trims each line; for purpose/notes. */
export function cleanMultiLine(value: string): string {
  return value
    .replace(/\r\n?/g, "\n")
    .replace(CONTROL_CHARS, "")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function singleLine(label: string, max: number) {
  return z
    .string({ error: `Please enter ${label}.` })
    .transform(cleanSingleLine)
    .pipe(
      z
        .string()
        .min(1, `Please enter ${label}.`)
        .max(max, `Please keep ${label} under ${max} characters.`),
    );
}

export function multiLine(label: string, max: number, { required = true } = {}) {
  const inner = z.string().max(max, `Please keep ${label} under ${max} characters.`);
  return z
    .string()
    .transform(cleanMultiLine)
    .pipe(required ? inner.min(1, `Please enter ${label}.`) : inner);
}

export const emailField = z
  .string({ error: "Please enter your email address." })
  .transform((v) => cleanSingleLine(v).toLowerCase())
  .pipe(
    z
      .string()
      .min(1, "Please enter your email address.")
      .max(254, "That email address is too long.")
      .pipe(z.email({ error: "Please enter a valid email address, like name@example.com." })),
  );

/**
 * Accepts the ways people naturally type phone numbers — (512) 555-0123,
 * 512.555.0123, +1 512 555 0123 — and normalizes to E.164 (+15125550123).
 * Numbers without a country code are assumed to be US.
 */
export function normalizePhone(value: string): string | null {
  const phone = parsePhoneNumberFromString(cleanSingleLine(value), "US");
  return phone?.isValid() ? phone.number : null;
}

export const phoneField = z
  .string({ error: "Please enter your phone number." })
  .transform((value, ctx) => {
    if (!cleanSingleLine(value)) {
      ctx.addIssue({ code: "custom", message: "Please enter your phone number." });
      return z.NEVER;
    }
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({ code: "custom", message: "Please enter a valid phone number, like (512) 555-0123." });
      return z.NEVER;
    }
    return normalized;
  });
