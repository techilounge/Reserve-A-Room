import type { ReactElement } from "react";

import { DetailsTable, EmailLayout, Paragraph, PrimaryButton } from "./components";
import type { EmailBrandData } from "./types";

export const SYSTEM_EMAIL_EVENTS = [
  "recurring_series_created",
  "recurring_request_received",
  "admin_first_login",
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

type Built = { subject: string; element: ReactElement };

export function buildSystemEmail(
  event: SystemEmailEvent,
  data: RecurringSeriesEmailData | RecurringRequestEmailData | AdminFirstLoginEmailData,
): Built {
  switch (event) {
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
