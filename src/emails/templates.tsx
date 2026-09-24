import type { ReactElement } from "react";

import { Callout, DetailsTable, EmailLayout, ManageLinkNote, Paragraph, PrimaryButton, StaffMessage } from "./components";
import type { EmailData, EmailEvent } from "./types";

type Built = { subject: string; element: ReactElement };

function bookingRows(d: EmailData): [string, string | null][] {
  return [
    ["Reference", d.referenceCode],
    ["Room", d.roomName],
    ["Date", d.date],
    ["Time", d.time],
    ["Ministry", d.ministry],
    ["Purpose", d.purpose],
    ["Attendance", String(d.estimatedAttendance)],
  ];
}

function staffRows(d: EmailData): [string, string | null][] {
  return [
    ...bookingRows(d),
    ["Requester", d.requesterName],
    ["Email", d.requesterEmail],
    ["Phone", d.requesterPhone],
    ["Setup needs", d.setupRequirements],
    ["Notes", d.requesterNotes],
  ];
}

function FoodPolicy({ d }: { d: EmailData }) {
  return (
    <Paragraph>
      {d.foodDrinksAllowed
        ? "Food and drinks are allowed in this room. Please leave it clean and tidy for the next group."
        : "Food and drinks are not allowed in this room."}
    </Paragraph>
  );
}

function ManageButton({ d, label }: { d: EmailData; label: string }) {
  if (!d.manageUrl) return null;
  return (
    <>
      <PrimaryButton href={d.manageUrl}>{label}</PrimaryButton>
      <ManageLinkNote />
    </>
  );
}

function CapacityWarning({ d }: { d: EmailData }) {
  if (d.estimatedAttendance <= d.roomCapacity) return null;
  return (
    <Callout title="Over the room's capacity">
      {`Expected attendance (${d.estimatedAttendance}) is more than ${d.roomName}'s capacity of ${d.roomCapacity}.`}
    </Callout>
  );
}

const templates: Record<EmailEvent, (d: EmailData) => Built> = {
  request_submitted: (d) => ({
    subject: `Request received: ${d.roomName} on ${d.date} (${d.referenceCode})`,
    element: (
      <EmailLayout data={d} preview={`We received your request for ${d.roomName}. It is waiting for approval.`} heading="We received your request">
        <Paragraph>Hi {d.requesterFirstName},</Paragraph>
        <Paragraph>
          Thank you. Your request for {d.roomName} is <strong>pending approval</strong>. The room is held for you while
          the church office reviews it, and we&apos;ll email you as soon as a decision is made.
        </Paragraph>
        <DetailsTable rows={bookingRows(d)} />
        <FoodPolicy d={d} />
        <ManageButton d={d} label="View or cancel your request" />
      </EmailLayout>
    ),
  }),

  admin_new_request: (d) => ({
    subject: `New room request: ${d.roomName} on ${d.date} (${d.referenceCode})`,
    element: (
      <EmailLayout data={d} preview={`${d.requesterName} requested ${d.roomName} for ${d.date}.`} heading="New request to review">
        <Paragraph>
          {d.requesterName} has requested {d.roomName}. The time is held until the request is approved or declined.
        </Paragraph>
        <CapacityWarning d={d} />
        <DetailsTable rows={staffRows(d)} />
        <PrimaryButton href={d.adminUrl}>Review request</PrimaryButton>
      </EmailLayout>
    ),
  }),

  reservation_confirmed: (d) => ({
    subject: `Reservation confirmed: ${d.roomName} on ${d.date} (${d.referenceCode})`,
    element: (
      <EmailLayout data={d} preview={`${d.roomName} is reserved for you on ${d.date}.`} heading="Your room is reserved">
        <Paragraph>Hi {d.requesterFirstName},</Paragraph>
        <Paragraph>Your reservation is confirmed. Here are the details:</Paragraph>
        <DetailsTable rows={bookingRows(d)} />
        <FoodPolicy d={d} />
        <ManageButton d={d} label="View or cancel your reservation" />
      </EmailLayout>
    ),
  }),

  reservation_approved: (d) => ({
    subject: `Approved: ${d.roomName} on ${d.date} (${d.referenceCode})`,
    element: (
      <EmailLayout data={d} preview={`Your request for ${d.roomName} on ${d.date} was approved.`} heading="Your request was approved">
        <Paragraph>Hi {d.requesterFirstName},</Paragraph>
        <Paragraph>Good news: the church office approved your request. {d.roomName} is reserved for you.</Paragraph>
        <StaffMessage message={d.requesterMessage} />
        <DetailsTable rows={bookingRows(d)} />
        <FoodPolicy d={d} />
        <ManageButton d={d} label="View or cancel your reservation" />
      </EmailLayout>
    ),
  }),

  reservation_declined: (d) => ({
    subject: `Request not approved: ${d.roomName} on ${d.date} (${d.referenceCode})`,
    element: (
      <EmailLayout data={d} preview={`Your request for ${d.roomName} on ${d.date} was not approved.`} heading="Your request was not approved">
        <Paragraph>Hi {d.requesterFirstName},</Paragraph>
        <Paragraph>
          We&apos;re sorry. The church office was unable to approve your request for {d.roomName}, and the time has been
          released.
        </Paragraph>
        <StaffMessage message={d.requesterMessage} />
        <DetailsTable rows={bookingRows(d)} />
        <Paragraph>You&apos;re welcome to submit a new request for another time or room.</Paragraph>
        <PrimaryButton href={`${d.appUrl}/availability`}>Check availability</PrimaryButton>
      </EmailLayout>
    ),
  }),

  reservation_modified: (d) => ({
    subject: `Reservation updated: ${d.roomName} on ${d.date} (${d.referenceCode})`,
    element: (
      <EmailLayout data={d} preview={`Your reservation ${d.referenceCode} was updated by the church office.`} heading="Your reservation was updated">
        <Paragraph>Hi {d.requesterFirstName},</Paragraph>
        <Paragraph>The church office changed your reservation. These are the current details:</Paragraph>
        <DetailsTable rows={bookingRows(d)} />
        <FoodPolicy d={d} />
        <Paragraph>If these details don&apos;t work for you, please contact the church office.</Paragraph>
        <ManageButton d={d} label="View your reservation" />
      </EmailLayout>
    ),
  }),

  reservation_cancelled: (d) => ({
    subject: `Reservation cancelled: ${d.roomName} on ${d.date} (${d.referenceCode})`,
    element: (
      <EmailLayout data={d} preview={`Reservation ${d.referenceCode} for ${d.roomName} was cancelled.`} heading="Your reservation was cancelled">
        <Paragraph>Hi {d.requesterFirstName},</Paragraph>
        <Paragraph>
          {d.cancelledByRequester
            ? `As you asked, your reservation for ${d.roomName} has been cancelled and the time released.`
            : `The church office cancelled your reservation for ${d.roomName}. We apologize for any inconvenience.`}
        </Paragraph>
        {d.cancelledByRequester ? null : <StaffMessage message={d.requesterMessage} />}
        <DetailsTable rows={bookingRows(d)} />
        <PrimaryButton href={`${d.appUrl}/availability`}>Find another time</PrimaryButton>
      </EmailLayout>
    ),
  }),

  admin_reservation_cancelled: (d) => ({
    subject: `Cancelled by requester: ${d.roomName} on ${d.date} (${d.referenceCode})`,
    element: (
      <EmailLayout data={d} preview={`${d.requesterName} cancelled ${d.referenceCode}.`} heading="A reservation was cancelled">
        <Paragraph>
          {d.requesterName} cancelled their reservation. {d.roomName} is available again for this time.
        </Paragraph>
        <DetailsTable rows={staffRows(d)} />
        <PrimaryButton href={d.adminUrl}>Open reservation</PrimaryButton>
      </EmailLayout>
    ),
  }),
};

export function buildEmail(event: EmailEvent, data: EmailData): Built {
  return templates[event](data);
}
