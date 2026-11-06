import type { ReactElement } from "react";

import { Callout, DetailsTable, EmailLayout, Paragraph, PrimaryButton } from "./components";
import type { EmailBrandData } from "./types";

export const SYSTEM_EMAIL_EVENTS = [
  "recurring_series_created",
  "recurring_series_staff_created",
  "recurring_request_received",
  "admin_first_login",
  "calendar_planner_invited",
  "calendar_plan_reminder",
  "calendar_event_approved",
  "calendar_event_replaced",
  "calendar_event_cancelled",
  "calendar_event_occurrence_cancelled",
  "calendar_plan_submitted",
  "calendar_plan_changes_requested",
] as const;
export type SystemEmailEvent = (typeof SYSTEM_EMAIL_EVENTS)[number];

export function isSystemEmailEvent(value: string): value is SystemEmailEvent {
  return (SYSTEM_EMAIL_EVENTS as readonly string[]).includes(value);
}

export type RecurringSeriesEmailData = EmailBrandData & {
  requesterFirstName: string;
  roomName: string;
  schedule: string;
  starts: string;
  ends: string;
  occurrenceCount: number;
  occurrenceSummary: string;
};

/** One staff summary for a whole series (instead of one email per occurrence). */
export type RecurringSeriesStaffEmailData = EmailBrandData & {
  roomName: string;
  requesterName: string;
  requesterEmail: string;
  requesterPhone: string;
  ministry: string | null;
  purpose: string;
  estimatedAttendance: number;
  schedule: string;
  starts: string;
  ends: string;
  occurrenceCount: number;
  occurrenceSummary: string;
  capacityWarning: string | null;
  seriesUrl: string;
};

export type AdminFirstLoginEmailData = EmailBrandData & {
  fullName: string;
  email: string;
  role: string;
  acceptedAt: string;
  usersUrl: string;
};

export type RecurringRequestEmailData = EmailBrandData & {
  requesterFirstName: string;
  referenceCode: string;
  roomName: string;
  preferredStartDate: string;
  preferredTime: string;
  recurrenceDescription: string;
  purpose: string;
  estimatedAttendance: number;
};

export type CalendarPlannerEmailData = EmailBrandData & {
  contactName: string;
  ministryName: string;
  cycleName: string;
  opensAt: string;
  deadline: string;
  invitationUrl: string;
};

export type CalendarEventNoticeEmailData = EmailBrandData & {
  eventTitle: string;
  ministry: string;
  cycle: string;
  revision: number;
  reason: string | null;
  occurrenceRange?: string;
};
export type CalendarPlanNoticeEmailData = EmailBrandData & {
  ministry: string;
  cycle: string;
  revision: number;
  reason: string | null;
};
export type CalendarReminderEmailData = EmailBrandData & {
  contactName:string; ministry:string; cycle:string; deadline:string; overdue:boolean;
};

type Built = { subject: string; element: ReactElement };

export function buildSystemEmail(
  event: SystemEmailEvent,
  data: RecurringSeriesEmailData | RecurringSeriesStaffEmailData | RecurringRequestEmailData | AdminFirstLoginEmailData | CalendarPlannerEmailData | CalendarEventNoticeEmailData | CalendarPlanNoticeEmailData | CalendarReminderEmailData,
): Built {
  switch (event) {
    case "calendar_plan_reminder": {
      const reminder=data as CalendarReminderEmailData;
      return { subject:`Church calendar planning reminder: ${reminder.ministry}`,
        element:<EmailLayout data={reminder} preview="A ministry calendar plan needs your attention." heading="Calendar planning reminder">
          <Paragraph>Hi {reminder.contactName},</Paragraph>
          <Paragraph>{reminder.overdue ? "The planning deadline has passed and your ministry plan has not been submitted." : "Your ministry calendar plan has not yet been submitted."}</Paragraph>
          <DetailsTable rows={[["Ministry",reminder.ministry],["Planning cycle",reminder.cycle],["Deadline",reminder.deadline]]} />
          <Paragraph>{reminder.overdue ? "Please contact the church office for help." : "Please use your personal planning invitation to finish and submit your plan. Contact the church office if you need a new invitation."}</Paragraph>
        </EmailLayout> };
    }
    case "calendar_plan_submitted":
    case "calendar_plan_changes_requested": {
      const notice = data as CalendarPlanNoticeEmailData;
      const changes = event === "calendar_plan_changes_requested";
      return {
        subject: changes ? `Church calendar changes requested: ${notice.ministry}` : `Church calendar plan submitted: ${notice.ministry}`,
        element: <EmailLayout data={notice} preview={changes ? "The church office requested changes to your plan." : "A church calendar plan is ready for review."}
          heading={changes ? "Changes requested to your calendar plan" : "A calendar plan was submitted"}>
          <Paragraph>{changes ? "The church office requested changes to your submitted plan." : "A ministry submitted its calendar plan for review."}</Paragraph>
          <DetailsTable rows={[["Ministry",notice.ministry],["Planning cycle",notice.cycle],["Submission",String(notice.revision)]]} />
          {notice.reason ? <Paragraph>Requested changes: {notice.reason}</Paragraph> : null}
          <Paragraph>{changes ? "Please use your personal planning link to revise and resubmit the plan." : "Sign in to the administration portal to review the plan."}</Paragraph>
        </EmailLayout>,
      };
    }
    case "calendar_event_approved":
    case "calendar_event_replaced":
    case "calendar_event_cancelled":
    case "calendar_event_occurrence_cancelled": {
      const notice = data as CalendarEventNoticeEmailData;
      const occurrence = event === "calendar_event_occurrence_cancelled";
      const status = event === "calendar_event_approved" ? "approved" : event === "calendar_event_replaced" ? "updated" : "cancelled";
      return {
        subject: `Church calendar ${occurrence ? "event date" : "event"} ${status}: ${notice.eventTitle}`,
        element: <EmailLayout data={notice} preview={`${notice.eventTitle} was ${status}.`} heading={`Church calendar ${occurrence ? "event date" : "event"} ${status}`}>
          <Paragraph>{occurrence ? "The church office cancelled one date of this event. Other dates remain unchanged." : `The church office has ${status} this event.`}</Paragraph>
          <DetailsTable rows={[["Event",notice.eventTitle],["Ministry",notice.ministry],["Planning cycle",notice.cycle],["Submission",String(notice.revision)],["Date",notice.occurrenceRange ?? null]]} />
          {notice.reason ? <Paragraph>Reason: {notice.reason}</Paragraph> : null}
          <Paragraph>Please contact the church office if you have questions about this change.</Paragraph>
        </EmailLayout>,
      };
    }
    case "calendar_planner_invited": {
      const planner = data as CalendarPlannerEmailData;
      return {
        subject: `Church calendar invitation: ${planner.ministryName}`,
        element: (
          <EmailLayout data={planner} preview={`You are invited to plan for ${planner.ministryName}.`} heading="Church calendar planning invitation">
            <Paragraph>Hi {planner.contactName},</Paragraph>
            <Paragraph>You have been invited to access the {planner.cycleName} planning cycle for {planner.ministryName}.</Paragraph>
            <DetailsTable rows={[["Planning opens", planner.opensAt], ["Planning deadline", planner.deadline]]} />
            <Paragraph>Your invitation is personal. Please do not forward this email.</Paragraph>
            <PrimaryButton href={planner.invitationUrl}>Open your invitation</PrimaryButton>
          </EmailLayout>
        ),
      };
    }
    case "recurring_series_staff_created": {
      const series = data as RecurringSeriesStaffEmailData;
      return {
        subject: `New recurring reservation: ${series.roomName} (${series.occurrenceCount} date${series.occurrenceCount === 1 ? "" : "s"})`,
        element: (
          <EmailLayout
            data={series}
            preview={`${series.requesterName} has a new recurring reservation for ${series.roomName}.`}
            heading="A recurring reservation was created"
          >
            <Paragraph>
              A recurring schedule was created for {series.requesterName}. This single message covers every date in
              the series, so you won&apos;t receive one email per occurrence.
            </Paragraph>
            {series.capacityWarning ? (
              <Callout title="Over the room's capacity">{series.capacityWarning}</Callout>
            ) : null}
            <DetailsTable
              rows={[
                ["Room", series.roomName],
                ["Schedule", series.schedule],
                ["Starts", series.starts],
                ["Ends", series.ends],
                ["Created", `${series.occurrenceCount} date${series.occurrenceCount === 1 ? "" : "s"} so far`],
                ["Dates", series.occurrenceSummary],
                ["Requester", series.requesterName],
                ["Email", series.requesterEmail],
                ["Phone", series.requesterPhone],
                ["Ministry", series.ministry],
                ["Purpose", series.purpose],
                ["Attendance", String(series.estimatedAttendance)],
              ]}
            />
            <Paragraph>
              Later dates are added automatically as they enter the room&apos;s advance-booking window, without further
              email.
            </Paragraph>
            <PrimaryButton href={series.seriesUrl}>Review the series</PrimaryButton>
          </EmailLayout>
        ),
      };
    }
    case "recurring_series_created": {
      const series = data as RecurringSeriesEmailData;
      return {
        subject: `Recurring reservation confirmed: ${series.roomName}`,
        element: (
          <EmailLayout
            data={series}
            preview={`Your recurring reservation for ${series.roomName} is confirmed.`}
            heading="Your recurring reservations are confirmed"
          >
            <Paragraph>Hi {series.requesterFirstName},</Paragraph>
            <Paragraph>
              The church office created a recurring reservation schedule for you. Each listed date is confirmed.
            </Paragraph>
            <DetailsTable
              rows={[
                ["Room", series.roomName],
                ["Schedule", series.schedule],
                ["Starts", series.starts],
                ["Ends", series.ends],
                ["Confirmed", `${series.occurrenceCount} occurrence${series.occurrenceCount === 1 ? "" : "s"}`],
                ["Dates", series.occurrenceSummary],
              ]}
            />
            <Paragraph>
              Please contact the church office if this schedule needs to change. Future dates will be confirmed as they
              enter the room&apos;s advance-booking window.
            </Paragraph>
            <PrimaryButton href={`${series.appUrl}/availability`}>View room availability</PrimaryButton>
          </EmailLayout>
        ),
      };
    }
    case "recurring_request_received": {
      const request = data as RecurringRequestEmailData;
      return {
        subject: `Recurring request received: ${request.roomName} (${request.referenceCode})`,
        element: (
          <EmailLayout
            data={request}
            preview={`We received your recurring room request for ${request.roomName}.`}
            heading="We received your recurring request"
          >
            <Paragraph>Hi {request.requesterFirstName},</Paragraph>
            <Paragraph>
              Your recurring room request was sent to the church office. This is a request, not a confirmed
              reservation. A staff member will contact you after reviewing the requested dates.
            </Paragraph>
            <DetailsTable
              rows={[
                ["Reference", request.referenceCode],
                ["Room", request.roomName],
                ["Preferred start", request.preferredStartDate],
                ["Preferred time", request.preferredTime],
                ["Schedule", request.recurrenceDescription],
                ["Purpose", request.purpose],
                ["Attendance", String(request.estimatedAttendance)],
              ]}
            />
            <Paragraph>
              Please keep the reference above for your records. No dates are reserved until the church office confirms
              them with you.
            </Paragraph>
            <PrimaryButton href={`${request.appUrl}/availability`}>View room availability</PrimaryButton>
          </EmailLayout>
        ),
      };
    }
    case "admin_first_login": {
      const admin = data as AdminFirstLoginEmailData;
      return {
        subject: `Administrator invitation accepted: ${admin.fullName}`,
        element: (
          <EmailLayout
            data={admin}
            preview={`${admin.fullName} accepted their Reserve-A-Room invitation.`}
            heading="An administrator accepted their invitation"
          >
            <Paragraph>
              {admin.fullName} completed password setup and entered the administration portal for the first time.
            </Paragraph>
            <DetailsTable
              rows={[
                ["Name", admin.fullName],
                ["Email", admin.email],
                ["Role", admin.role],
                ["Accepted", admin.acceptedAt],
              ]}
            />
            <PrimaryButton href={admin.usersUrl}>Review Users &amp; Roles</PrimaryButton>
          </EmailLayout>
        ),
      };
    }
  }
}
