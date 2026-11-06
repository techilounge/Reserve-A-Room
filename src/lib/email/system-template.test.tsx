import { render } from "@react-email/render";
import { describe, expect, it } from "vitest";

import {
  buildSystemEmail,
  type AdminFirstLoginEmailData,
  type RecurringRequestEmailData,
  type RecurringSeriesEmailData,
  type RecurringSeriesStaffEmailData,
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

describe("church calendar planner invitation", () => {
  it("shows the ministry, opening and deadline in branded HTML and text", async () => {
    const built = buildSystemEmail("calendar_planner_invited", {
      appUrl: data.appUrl, appName: data.appName, churchName: data.churchName,
      contactEmail: data.contactEmail, contactPhone: data.contactPhone,
      contactName: "Ada <Planner>", ministryName: "Music Ministry", cycleName: "2027 Planning",
      opensAt: "Oct 30, 2026, 9:00 AM", deadline: "Dec 1, 2026, 5:00 PM",
      invitationUrl: "https://reservearoom.example.org/calendar-plan/test?token=example",
    });
    const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);
    expect(html).toContain("Ada &lt;Planner&gt;");
    expect(html).toContain("Music Ministry");
    expect(text).toContain("Planning opens");
    expect(text).toContain("Dec 1, 2026, 5:00 PM");
    expect(text).toContain("do not forward");
  });
});

describe("church calendar reminders", () => {
  it.each([false,true])("renders safe branded reminder with overdue=%s", async overdue => {
    const built=buildSystemEmail("calendar_plan_reminder",{
      appUrl:data.appUrl,appName:data.appName,churchName:data.churchName,contactEmail:data.contactEmail,contactPhone:data.contactPhone,
      contactName:"Ada <Planner>",ministry:"Music Ministry",cycle:"2027 Planning",deadline:"Dec 1, 2026",overdue,
    });
    const [html,text]=await Promise.all([render(built.element),render(built.element,{plainText:true})]);
    expect(html).toContain("Ada &lt;Planner&gt;");
    expect(text).toContain("Music Ministry");
    expect(text).toContain("Dec 1, 2026");
    expect(text).toContain(overdue ? "deadline has passed" : "personal planning invitation");
    expect(text).not.toContain("token=");
  });
});

describe("church calendar event notices", () => {
  it.each([
    ["calendar_event_approved", "approved"],
    ["calendar_event_replaced", "updated"],
    ["calendar_event_cancelled", "cancelled"],
    ["calendar_event_occurrence_cancelled", "cancelled"],
  ] as const)("renders the branded %s notice", async (event, status) => {
    const built = buildSystemEmail(event, {
      appUrl: data.appUrl, appName: data.appName, churchName: data.churchName,
      contactEmail: data.contactEmail, contactPhone: data.contactPhone,
      eventTitle: "Youth <Night>", ministry: "Youth Ministry", cycle: "2027 Planning", revision: 2,
      reason: event === "calendar_event_cancelled" || event === "calendar_event_occurrence_cancelled" ? "Schedule changed" : null,
      ...(event === "calendar_event_occurrence_cancelled" ? { occurrenceRange:"Nov 10, 2027, 10 AM – 11 AM" } : {}),
    });
    const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);
    expect(built.subject).toContain(status);
    expect(html).toContain("Youth &lt;Night&gt;");
    expect(text).toContain("Youth Ministry");
    expect(text).toContain("2027 Planning");
    if (event === "calendar_event_cancelled" || event === "calendar_event_occurrence_cancelled") expect(text).toContain("Schedule changed");
    if (event === "calendar_event_occurrence_cancelled") expect(text).toContain("Other dates remain unchanged");
  });
});

describe("church calendar plan notices", () => {
  it.each([
    ["calendar_plan_submitted", "submitted"],
    ["calendar_plan_changes_requested", "Changes requested"],
  ] as const)("renders %s in HTML and text", async (event, message) => {
    const built = buildSystemEmail(event, {
      appUrl: data.appUrl, appName: data.appName, churchName: data.churchName,
      contactEmail: data.contactEmail, contactPhone: data.contactPhone,
      ministry: "Youth <Ministry>", cycle: "2027 Planning", revision: 2,
      reason: event === "calendar_plan_changes_requested" ? "Please revise the time" : null,
    });
    const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);
    expect(html).toContain("Youth &lt;Ministry&gt;");
    expect(text.toLowerCase()).toContain(message.toLowerCase());
    if (event === "calendar_plan_changes_requested") expect(text).toContain("Please revise the time");
  });
});

describe("recurring-request acknowledgement email", () => {
  it("makes the request status explicit and includes the submitted schedule", async () => {
    const request: RecurringRequestEmailData = {
      appUrl: data.appUrl,
      appName: data.appName,
      churchName: data.churchName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone,
      requesterFirstName: "Jamie",
      referenceCode: "RRR-20260927-JTP3",
      roomName: "Main Sanctuary",
      preferredStartDate: "Saturday, October 3, 2026",
      preferredTime: "2:00 PM – 4:00 PM",
      recurrenceDescription: "Second & fourth <Saturday> of every month",
      purpose: "Monthly ministry meeting",
      estimatedAttendance: 20,
    };
    const built = buildSystemEmail("recurring_request_received", request);
    const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);
    expect(built.subject).toContain("RRR-20260927-JTP3");
    expect(html).toContain("Second &amp; fourth &lt;Saturday&gt;");
    expect(html).toContain("https://reservearoom.example.org/availability");
    expect(text).toContain("not a confirmed reservation");
    expect(text).toContain("Saturday, October 3, 2026");
    expect(text).toContain("2:00 PM – 4:00 PM");
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

describe("recurring-series staff summary email", () => {
  const staff: RecurringSeriesStaffEmailData = {
    appUrl: data.appUrl,
    appName: data.appName,
    churchName: data.churchName,
    contactEmail: data.contactEmail,
    contactPhone: data.contactPhone,
    roomName: "Conference Room",
    requesterName: "Michelle Escalante",
    requesterEmail: "michelle@example.org",
    requesterPhone: "(512) 555-0123",
    ministry: "Women's Ministry",
    purpose: "Weekly prayer <circle>",
    estimatedAttendance: 20,
    schedule: "Every Sunday, 2:00 PM – 3:00 PM",
    starts: "Sunday, October 4, 2026",
    ends: "After one year or 50 instances",
    occurrenceCount: 50,
    occurrenceSummary: "Sunday, October 4, 2026\n…and 49 more",
    capacityWarning: "Expected attendance (20) is more than Conference Room's capacity of 15.",
    seriesUrl: "https://reservearoom.example.org/admin/reservation-series/abc",
  };

  it("summarizes the whole series in one message", async () => {
    const built = buildSystemEmail("recurring_series_staff_created", staff);
    const [html, text] = await Promise.all([render(built.element), render(built.element, { plainText: true })]);
    expect(built.subject).toBe("New recurring reservation: Conference Room (50 dates)");
    expect(html).toContain("Weekly prayer &lt;circle&gt;");
    expect(html).toContain("https://reservearoom.example.org/admin/reservation-series/abc");
    expect(text).toContain("so far");
    expect(text).toContain("Over the room");
    expect(text).toContain("…and 49 more");
  });

  it("omits the capacity warning when attendance fits", async () => {
    const built = buildSystemEmail("recurring_series_staff_created", { ...staff, capacityWarning: null, occurrenceCount: 1 });
    const text = await render(built.element, { plainText: true });
    expect(built.subject).toBe("New recurring reservation: Conference Room (1 date)");
    expect(text).not.toContain("Over the room");
  });
});
