import { parsePhoneNumberFromString } from "libphonenumber-js/min";

/** "+15125550123" → "(512) 555-0123"; international numbers keep their international format. */
export function formatPhone(e164: string): string {
  const phone = parsePhoneNumberFromString(e164);
  if (!phone) return e164;
  return phone.country === "US" ? phone.formatNational() : phone.formatInternational();
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n} ${n === 1 ? singular : pluralForm}`;
}
