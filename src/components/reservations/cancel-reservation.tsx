"use client";

import { LoaderCircle } from "lucide-react";
import { useActionState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { CancelState } from "@/app/(public)/reservation/[reference]/actions";

export function CancelReservation({
  action,
}: {
  action: (prev: CancelState, form: FormData) => Promise<CancelState>;
}) {
  const [state, formAction, pending] = useActionState(action, { status: "idle" } satisfies CancelState);

  return (
    <div className="space-y-3">
      <AlertDialog>
        <AlertDialogTrigger asChild>
          <Button variant="destructive" disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            {pending ? "Cancelling…" : "Cancel reservation"}
          </Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this reservation?</AlertDialogTitle>
            <AlertDialogDescription>
              The room will be released for others to reserve. This can&apos;t be undone — you would need to make a new
              reservation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep reservation</AlertDialogCancel>
            <form action={formAction}>
              <AlertDialogAction type="submit" className="w-full sm:w-auto">
                Yes, cancel it
              </AlertDialogAction>
            </form>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <p role="status" aria-live="polite" className="text-sm">
        {state.status === "error" ? <span className="text-destructive">{state.message}</span> : null}
      </p>
    </div>
  );
}
