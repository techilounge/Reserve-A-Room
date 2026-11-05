"use client";

import { approveCalendarEvent, cancelCalendarEvent, cancelCalendarOccurrence } from "@/app/admin/(portal)/calendar-submissions/actions";
import { AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";

export function CalendarApprovalControl({ eventId,revision,commitmentId,requiresRoomContact }: { eventId:string; revision:number; commitmentId?:string; requiresRoomContact:boolean }) {
  const replacing = Boolean(commitmentId);
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button type="button" variant="outline">{replacing ? "Review replacement approval" : "Review event approval"}</Button></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>{replacing ? "Approve this revision?" : "Approve this event?"}</AlertDialogTitle>
        <AlertDialogDescription>{replacing ? "Future room and resource commitments will be replaced together if all checks pass." : "Requested rooms and resources will be confirmed together if all checks pass."}{requiresRoomContact ? " Enter the planner’s contact details for the room holds." : ""}</AlertDialogDescription></AlertDialogHeader>
      <form action={approveCalendarEvent} className="space-y-3">
        <input type="hidden" name="event" value={eventId} /><input type="hidden" name="revision" value={revision} />
        {commitmentId ? <input type="hidden" name="commitment" value={commitmentId} /> : null}
        {requiresRoomContact ? <><label className="block text-sm font-medium">Contact first name<input className="mt-1 block w-full rounded border bg-background p-2" name="firstName" maxLength={80} required /></label>
        <label className="block text-sm font-medium">Contact last name<input className="mt-1 block w-full rounded border bg-background p-2" name="lastName" maxLength={80} required /></label>
        <label className="block text-sm font-medium">Contact phone, including country code<input className="mt-1 block w-full rounded border bg-background p-2" name="phone" type="tel" placeholder="+15125550123" pattern="\+[1-9][0-9]{6,14}" required /></label></> : null}
        <AlertDialogFooter><AlertDialogCancel type="button">Keep reviewing</AlertDialogCancel><Button type="submit">{replacing ? "Approve revision" : "Approve event"}</Button></AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}

export function CalendarCancellationControl({ eventId,commitmentId,title }: { eventId:string; commitmentId:string; title:string }) {
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button type="button" variant="outline">Cancel event</Button></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Cancel {title}?</AlertDialogTitle>
        <AlertDialogDescription>Future room and resource commitments will be released together. Past records will remain available.</AlertDialogDescription></AlertDialogHeader>
      <form action={cancelCalendarEvent} className="space-y-3">
        <input type="hidden" name="event" value={eventId} /><input type="hidden" name="commitment" value={commitmentId} />
        <label className="block text-sm font-medium">Cancellation reason<textarea name="reason" minLength={3} maxLength={2000} required className="mt-1 block w-full rounded border bg-background p-2" /></label>
        <AlertDialogFooter><AlertDialogCancel type="button">Keep event</AlertDialogCancel><Button type="submit" variant="destructive">Cancel event</Button></AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}

export function CalendarOccurrenceCancellationControl({ eventId,commitmentId,occurrenceId,submissionId }: { eventId:string; commitmentId:string; occurrenceId:string; submissionId:string }) {
  return <AlertDialog>
    <AlertDialogTrigger asChild><Button type="button" variant="outline">Cancel this date</Button></AlertDialogTrigger>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>Cancel this date?</AlertDialogTitle>
        <AlertDialogDescription>Room and resource commitments for this date will be released. Other dates will remain unchanged.</AlertDialogDescription></AlertDialogHeader>
      <form action={cancelCalendarOccurrence} className="space-y-3">
        <input type="hidden" name="event" value={eventId} /><input type="hidden" name="commitment" value={commitmentId} />
        <input type="hidden" name="occurrence" value={occurrenceId} /><input type="hidden" name="submission" value={submissionId} />
        <label className="block text-sm font-medium">Cancellation reason<textarea name="reason" minLength={3} maxLength={2000} required className="mt-1 block w-full rounded border bg-background p-2" /></label>
        <AlertDialogFooter><AlertDialogCancel type="button">Keep date</AlertDialogCancel><Button type="submit" variant="destructive">Cancel date</Button></AlertDialogFooter>
      </form>
    </AlertDialogContent>
  </AlertDialog>;
}
