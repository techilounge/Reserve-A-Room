import { describe, expect, it } from "vitest";

import { fieldErrors, reservationSchema } from "./reservation";
import { cleanMultiLine, cleanSingleLine, normalizePhone } from "./text";

const valid = {
  roomId: "5d1c0c2e-6f3a-4a8e-9c1d-2b7e8f9a0b1c",
  date: "2026-10-15",
  start: "09:00",
  end: "10:30",
  firstName: "Grace",
  lastName: "Hopper",
  email: "grace@example.org",
  phone: "(512) 555-0123",
  ministryId: "8a2f3b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b",
  otherMinistryName: "",
  purpose: "Planning meeting",
  estimatedAttendance: "12",
  setupRequirements: "",
  requesterNotes: "",
  legalAccepted: true,
};

const errorsFor = (input: Record<string, unknown>) => {
  const result = reservationSchema.safeParse(input);
  return result.success ? {} : fieldErrors(result.error);
};

describe("reservationSchema", () => {
  it("accepts a complete reservation and normalizes it", () => {
    const result = reservationSchema.parse({ ...valid, email: "  Grace@Example.ORG ", firstName: "  Grace   Ann " });
    expect(result).toMatchObject({
      email: "grace@example.org",
      firstName: "Grace Ann",
      phone: "+15125550123",
      estimatedAttendance: 12,
      otherMinistryName: undefined,
      setupRequirements: undefined,
    });
  });

  it("requires every guest field from the brief", () => {
    const errors = errorsFor({
      ...valid,
      firstName: " ",
      lastName: "",
      email: "",
      phone: "",
      ministryId: "",
      purpose: "   ",
      estimatedAttendance: "",
    });
    expect(Object.keys(errors).sort()).toEqual(
      ["email", "estimatedAttendance", "firstName", "lastName", "ministryId", "phone", "purpose"].sort(),
    );
    expect(errors.firstName).toBe("Please enter your first name.");
  });

  it("requires explicit Privacy Policy and Terms acceptance", () => {
    expect(errorsFor({ ...valid, legalAccepted: false }).legalAccepted).toBe(
      "Please accept the Privacy Policy and Terms of Service to continue.",
    );
    expect(errorsFor({ ...valid, legalAccepted: undefined }).legalAccepted).toBeDefined();
  });

  it("validates email and phone formats with friendly messages", () => {
    expect(errorsFor({ ...valid, email: "not-an-email" }).email).toMatch(/valid email/);
    expect(errorsFor({ ...valid, phone: "12345" }).phone).toMatch(/valid phone/);
  });

  it("requires a positive whole number of attendees", () => {
    expect(errorsFor({ ...valid, estimatedAttendance: "0" }).estimatedAttendance).toBeDefined();
    expect(errorsFor({ ...valid, estimatedAttendance: "-3" }).estimatedAttendance).toBeDefined();
    expect(errorsFor({ ...valid, estimatedAttendance: "2.5" }).estimatedAttendance).toBe("Please enter a whole number.");
    // Over capacity is NOT a validation error — it's a warning handled elsewhere.
    expect(errorsFor({ ...valid, estimatedAttendance: "500" })).toEqual({});
  });

  it("requires a name when 'Other / Not Listed' is chosen", () => {
    expect(errorsFor({ ...valid, ministryId: "other" }).otherMinistryName).toBe("Please enter your ministry or group name.");
    const parsed = reservationSchema.parse({ ...valid, ministryId: "other", otherMinistryName: "  Youth   Choir " });
    expect(parsed.otherMinistryName).toBe("Youth Choir");
  });

  it("drops an 'other' name when a listed ministry is chosen", () => {
    expect(reservationSchema.parse({ ...valid, otherMinistryName: "ignored" }).otherMinistryName).toBeUndefined();
  });

  it("rejects end times before start times and malformed dates/times", () => {
    expect(errorsFor({ ...valid, end: "08:30" }).end).toBe("The end time must be after the start time.");
    expect(errorsFor({ ...valid, date: "2026-02-30" }).date).toBeDefined();
    expect(errorsFor({ ...valid, start: "9am" }).start).toBeDefined();
    expect(errorsFor({ ...valid, roomId: "1 OR 1=1" }).roomId).toBe("Please choose a room.");
  });

  it("enforces length limits", () => {
    expect(errorsFor({ ...valid, purpose: "x".repeat(501) }).purpose).toMatch(/under 500/);
    expect(errorsFor({ ...valid, firstName: "x".repeat(81) }).firstName).toMatch(/under 80/);
  });
});

describe("text cleaning", () => {
  it("strips control characters and collapses whitespace", () => {
    expect(cleanSingleLine("  Grace\u0000​  Hopper\t")).toBe("Grace Hopper");
    expect(cleanMultiLine("Line 1\r\n\r\n\r\n\r\nLine 2  \n  indented")).toBe("Line 1\n\nLine 2\nindented");
  });

  it("keeps markup as plain text (it is escaped on output, never interpreted)", () => {
    expect(cleanSingleLine("<script>alert(1)</script>")).toBe("<script>alert(1)</script>");
  });
});

describe("normalizePhone", () => {
  it.each([
    ["(512) 555-0123", "+15125550123"],
    ["512.555.0123", "+15125550123"],
    ["+1 512 555 0123", "+15125550123"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it("rejects invalid numbers", () => {
    expect(normalizePhone("555-0123")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
  });
});

describe("friendly messages for empty selects and numbers", () => {
  it("asks for a ministry and attendance in plain words", () => {
    const errors = errorsFor({ ...valid, ministryId: "", estimatedAttendance: "" });
    expect(errors.ministryId).toBe("Please choose your ministry or group.");
    expect(errors.estimatedAttendance).toBe("Please enter how many people will attend.");
  });
});
