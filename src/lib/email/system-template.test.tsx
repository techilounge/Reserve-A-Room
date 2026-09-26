import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import {
  buildSystemEmail,
  type AdminFirstLoginEmailData,
  type RecurringSeriesEmailData,
} from "@/emails/system-templates";

const data: RecurringSeriesEmailData = {
  appUrl: "https://reservearoom.example.org",
  appName: "Reserve-A-Room",
  churchName: "Stonehill Seventh-day Adventist Church",
  contactEmail: "office@example.org",
  contactPhone: null,
  requesterFirstName: "Katherine",
  roomName: "Conference <Room>",
  schedule: "Every Saturday, 2:00 PM – 3:00 PM",
  starts: "Saturday, October 3, 2026",
  ends: "No end date",
  occurrenceCount: 3,
  occurrenceSummary: "Saturday, October 3, 2026\nSaturday, October 10, 2026\nSaturday, October 17, 2026",
};

describe("recurring-series summary email", () => {
  it("renders branded HTML and a useful plain-text alternative", async () => {
    const built = buildSystemEmail("recurring_series_created", data);
    const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);
    expect(built.subject).toContain("Recurring reservation confirmed");
    expect(html).toContain("Conference &lt;Room&gt;");
    expect(html).toContain("Every Saturday");
    expect(html).toContain("https://reservearoom.example.org/availability");
    expect(text).toContain("Saturday, October 10, 2026");
    expect(text).toContain("No end date");
  });
});

describe("administrator first-login email", () => {
  it("renders the accepted administrator and a safe Users & Roles link", async () => {
    const lifecycle: AdminFirstLoginEmailData = {
      appUrl: data.appUrl,
      appName: data.appName,
      churchName: data.churchName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      fullName: "Ada <Lovelace>",
      email: "ada@example.org",
      role: "Admin",
      acceptedAt: "Sep 25, 2026, 2:30 PM",
      usersUrl: "https://reservearoom.example.org/admin/users",
    };
    const built = buildSystemEmail("admin_first_login", lifecycle);
    const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);
    expect(built.subject).toContain("Administrator invitation accepted");
    expect(html).toContain("Ada &lt;Lovelace&gt;");
    expect(html).toContain("https://reservearoom.example.org/admin/users");
    expect(text).toContain("ada@example.org");
    expect(text).toContain("Sep 25, 2026, 2:30 PM");
  });
});
