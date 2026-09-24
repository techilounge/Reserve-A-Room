"use client";

import { LoaderCircle, Lock } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveAdminNotesAction } from "@/app/admin/(portal)/reservations/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Private staff notes — never shown to requesters or included in emails. */
export function AdminNotesForm({ reservationId, initial }: { reservationId: string; initial: string }) {
  const [notes, setNotes] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = notes !== saved;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        startTransition(async () => {
          const result = await saveAdminNotesAction(reservationId, notes);
          if (!result.ok) return setError(result.message);
          setSaved(notes);
          toast.success("Private notes saved.");
        });
      }}
      className="space-y-2"
    >
      <Label htmlFor="admin-notes" className="gap-1.5">
        <Lock className="size-3.5" aria-hidden />
        Private staff notes
      </Label>
      <Textarea
        id="admin-notes"
        rows={4}
        maxLength={4000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        aria-describedby="admin-notes-help"
      />
      <p id="admin-notes-help" className="text-xs text-muted-foreground">
        Visible to staff only. Never shown to the requester or included in emails.
      </p>
      {error ? (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" size="sm" variant="secondary" disabled={!dirty || pending}>
        {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
        {pending ? "Saving…" : "Save notes"}
      </Button>
    </form>
  );
}
