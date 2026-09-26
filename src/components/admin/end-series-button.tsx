"use client";

import { LoaderCircle, OctagonX } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { endReservationSeriesAction } from "@/app/admin/(portal)/reservations/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export function EndSeriesButton({ seriesId }: { seriesId: string }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function endSeries() {
    setError(null);
    startTransition(async () => {
      const result = await endReservationSeriesAction(seriesId);
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      toast.success(result.message);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant="destructive">
          <OctagonX data-icon="inline-start" aria-hidden />
          End series
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>End this recurring series?</DialogTitle>
          <DialogDescription>
            No new occurrences will be generated. Existing reservations remain confirmed and can still be managed individually.
          </DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Keep active
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={endSeries} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            {pending ? "Ending…" : "End future generation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
