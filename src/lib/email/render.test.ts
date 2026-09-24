import { describe, expect, it } from "vitest";

import { EMAIL_EVENTS, type EmailEvent } from "@/emails/types";

import { toEmailData, type EmailContextRow } from "./data";
import { renderEmail } from "./render";

const row: EmailContextRow = {
  email_id: "e1",
  recipient: "jane@example.org",
  event_type: "request_submitted",
  attempt_count: 1,
  reservation_id: "11111111-1111-4111-8111-111111111111",
  reference_code: "RAR-20261001-7K2M",
  room_name: "Fellowship Hall",
  room_capacity: 10,
  start_at: "2026-10-01T14:00:00Z", // 9:00 AM CDT
  end_at: "2026-10-01T15:30:00Z",
  requester_first_name: "Jane",
  requester_last_name: "Doe",
  requester_email: "jane@example.org",
  requester_phone: "+15125550123",
  ministry_name: "Youth Ministry",
  purpose: "Planning <meeting> & snacks",
  estimated_attendance: 14,
  setup_requirements: null,
  requester_notes: null,
  requester_message: "Please use the side door.",
  food_drinks_allowed: false,
  cancelled_by_requester: false,
  church_name: "Stonehill Seventh-day Adventist Church",
  app_name: "Reserve-A-Room",
  timezone: "America/Chicago",
  contact_email: "office@example.org",
  contact_phone: null,
};

const manageUrl = "https://reservearoom.example.org/reservation/RAR-20261001-7K2M?token=abc";
const data = toEmailData(row, { appUrl: "https://reservearoom.example.org/", manageUrl });

describe("email data", () => {
  it("formats the booking in the church timezone", () => {
    expect(data.date).toBe("Thursday, October 1, 2026");
    expect(data.time).toBe("9:00 AM – 10:30 AM CDT");
    expect(data.requesterPhone).toBe("(512) 555-0123");
    expect(data.adminUrl).toBe("https://reservearoom.example.org/admin/reservations/11111111-1111-4111-8111-111111111111");
  });
});

describe("email templates", () => {
  it.each(EMAIL_EVENTS)("renders %s with details, escaping and a text version", async (event) => {
    const email = await renderEmail(event, data);
    expect(email.subject).toContain("RAR-20261001-7K2M");
    expect(email.html).toContain("Fellowship Hall");
    expect(email.html).toContain("Thursday, October 1, 2026");
    expect(email.html).toContain("Planning &lt;meeting&gt; &amp; snacks");
    expect(email.html).not.toContain("<meeting>");
    expect(email.text).toContain("RAR-20261001-7K2M");
    expect(email.text).toMatch(/Room\s+Fellowship Hall/);
    expect(email.text.length).toBeGreaterThan(100);
  });

  const requesterEvents: EmailEvent[] = ["request_submitted", "reservation_confirmed", "reservation_approved", "reservation_modified"];
  it.each(requesterEvents)("%s includes the private manage link", async (event) => {
    const { html } = await renderEmail(event, data);
    expect(html).toContain(manageUrl);
    expect(html).toContain("Food and drinks are not allowed");
  });

  it("staff emails link to the admin portal, not the requester's private link", async () => {
    for (const event of ["admin_new_request", "admin_reservation_cancelled"] as const) {
      const { html } = await renderEmail(event, data);
      expect(html).toContain(data.adminUrl);
      expect(html).not.toContain("token=");
    }
  });

  it("warns staff when attendance exceeds capacity", async () => {
    expect((await renderEmail("admin_new_request", data)).html).toContain("Over the room");
    expect((await renderEmail("admin_new_request", { ...data, estimatedAttendance: 8 })).html).not.toContain("Over the room");
  });

  it("shows the staff message on declines and staff cancellations only", async () => {
    expect((await renderEmail("reservation_declined", data)).html).toContain("Please use the side door.");
    expect((await renderEmail("reservation_cancelled", data)).html).toContain("Please use the side door.");
    expect((await renderEmail("reservation_cancelled", { ...data, cancelledByRequester: true })).html).not.toContain("side door");
  });

  it("omits the manage button when no link can be built", async () => {
    const { html } = await renderEmail("reservation_confirmed", { ...data, manageUrl: null });
    expect(html).not.toContain("token=");
    expect(html).not.toContain("private link");
  });
});

// Writes rendered samples for a visual check: EMAIL_PREVIEW_DIR=… npx vitest run src/lib/email
if (process.env.EMAIL_PREVIEW_DIR) {
  it("writes previews", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    await mkdir(process.env.EMAIL_PREVIEW_DIR!, { recursive: true });
    for (const event of EMAIL_EVENTS) {
      const email = await renderEmail(event, data);
      await writeFile(`${process.env.EMAIL_PREVIEW_DIR}/${event}.html`, email.html);
      await writeFile(`${process.env.EMAIL_PREVIEW_DIR}/${event}.txt`, `${email.subject}\n\n${email.text}`);
    }
  });
}
