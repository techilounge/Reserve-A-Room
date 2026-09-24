import { describe, expect, it } from "vitest";

import { roomSchema, settingsSchema, slugify } from "./super";

const room = {
  id: null,
  name: "Fellowship Hall",
  slug: "fellowship-hall",
  description: "",
  location: "",
  capacity: "120",
  sortOrder: "20",
  active: true,
  reservable: true,
  unavailableMessage: "",
  approvalRequired: true,
  foodDrinksAllowed: true,
  useDefaultAdvance: false,
  advanceValue: "8",
  advanceUnit: "week" as const,
  amenityIds: [],
};

describe("slugify", () => {
  it("makes URL-safe slugs from room names", () => {
    expect(slugify("Fellowship Hall")).toBe("fellowship-hall");
    expect(slugify("  Mother's Room & Nursery!  ")).toBe("mother-s-room-and-nursery");
    expect(slugify("Café Área 2")).toBe("cafe-area-2");
  });
});

describe("roomSchema", () => {
  it("accepts a valid room", () => {
    expect(roomSchema.parse(room)).toMatchObject({ capacity: 120, advanceValue: 8, advanceUnit: "week" });
  });

  it("enforces advance-booking bounds per unit, unless using the default", () => {
    expect(roomSchema.safeParse({ ...room, advanceValue: "25", advanceUnit: "month" }).success).toBe(false);
    expect(roomSchema.safeParse({ ...room, advanceValue: "0" }).success).toBe(false);
    expect(roomSchema.safeParse({ ...room, useDefaultAdvance: true, advanceValue: "0" }).success).toBe(true);
  });

  it("rejects bad slugs and capacities", () => {
    expect(roomSchema.safeParse({ ...room, slug: "Fellowship Hall" }).success).toBe(false);
    expect(roomSchema.safeParse({ ...room, capacity: "0" }).success).toBe(false);
  });
});

describe("settingsSchema", () => {
  const settings = {
    churchName: "Stonehill Seventh-day Adventist Church",
    appName: "Reserve-A-Room",
    timezone: "America/Chicago",
    contactEmail: "",
    contactPhone: "",
    bookingIntervalMinutes: "30",
    defaultAdvanceValue: "8",
    defaultAdvanceUnit: "week" as const,
    minLeadTimeMinutes: "0",
    bookableDayStart: "06:00",
    bookableDayEnd: "22:00",
    allowGuestCancellation: true,
    extraRecipients: "office@example.org, Pastor@Example.org",
    emailSenderName: "Stonehill Reserve-A-Room",
  };

  it("parses recipients from a comma or newline separated list", () => {
    expect(settingsSchema.parse(settings).extraRecipients).toEqual(["office@example.org", "pastor@example.org"]);
    expect(settingsSchema.parse({ ...settings, extraRecipients: "" }).extraRecipients).toEqual([]);
  });

  it("rejects invalid timezones, windows and emails", () => {
    expect(settingsSchema.safeParse({ ...settings, timezone: "Mars/Olympus" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...settings, bookableDayEnd: "05:00" }).success).toBe(false);
    expect(settingsSchema.safeParse({ ...settings, extraRecipients: "not-an-email" }).success).toBe(false);
  });
});
