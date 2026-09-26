import type { ReactElement } from "react";

import { DetailsTable, EmailLayout, Paragraph, PrimaryButton } from "./components";
import type { EmailBrandData } from "./types";

export const SYSTEM_EMAIL_EVENTS = ["recurring_series_created", "admin_first_login"] as const;
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

type Built = { subject: string; element: ReactElement };

export function buildSystemEmail(
  event: SystemEmailEvent,
  data: RecurringSeriesEmailData | AdminFirstLoginEmailData,
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
