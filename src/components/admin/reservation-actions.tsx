"use client";

import { Ban, CircleCheck, CircleX, LoaderCircle, Lock } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import {
  approveReservationAction,
  cancelReservationAction,
  declineReservationAction,
  type ActionResult,
} from "@/app/admin/(portal)/reservations/actions";
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
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";

type Kind = "approve" | "decline" | "cancel";

const DECLINE_REASONS = [
  "The room is unavailable at that time.",
  "There is a scheduling conflict with another church event.",
  "The expected attendance exceeds what this room can comfortably hold.",
  "Please contact the church office to discuss this request.",
];

const COPY = {
  approve: {
    trigger: "Approve",
    title: "Approve this request?",
    description: "The requester will receive an approval email.",
    confirm: "Approve",
    busy: "Approving…",
    icon: CircleCheck,
    variant: "default" as const,
  },
  decline: {
    trigger: "Decline",
    title: "Decline this request?",
    description: "The requester will be emailed, and the time becomes available to others.",
    confirm: "Decline request",
    busy: "Declining…",
    icon: CircleX,
    variant: "destructive" as const,
  },
  cancel: {
    trigger: "Cancel reservation",
    title: "Cancel this reservation?",
    description: "The requester will be emailed, and the time becomes available to others. This can't be undone.",
    confirm: "Cancel reservation",
    busy: "Cancelling…",
    icon: Ban,
    variant: "destructive" as const,
  },
};

function ActionDialog({
  kind,
  reservationId,
  reference,
  size = "default",
}: {
  kind: Kind;
  reservationId: string;
  reference: string;
  size?: "default" | "sm";
}) {
  const copy = COPY[kind];
  const Icon = copy.icon;
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [reason, setReason] = useState("");
  const [adminNote, setAdminNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit() {
    setError(null);
    startTransition(async () => {
      const text = [reason, message.trim()].filter(Boolean).join(" ");
      let result: ActionResult;
      if (kind === "approve") result = await approveReservationAction(reservationId, { message: text });
      else if (kind === "decline") result = await declineReservationAction(reservationId, { message: text, adminNote });
      else result = await cancelReservationAction(reservationId, { message: text });
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setOpen(false);
      toast.success(`${reference}: ${result.message}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && setOpen(next)}>
      <DialogTrigger asChild>
        <Button variant={kind === "approve" ? "default" : kind === "decline" ? "outline" : "destructive"} size={size}>
          <Icon data-icon="inline-start" aria-hidden />
          {copy.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{copy.title}</DialogTitle>
          <DialogDescription>
            {reference} · {copy.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {kind === "decline" ? (
            <div className="space-y-1.5">
              <Label htmlFor={`${kind}-reason`}>Reason (shared with the requester)</Label>
              <NativeSelect id={`${kind}-reason`} value={reason} onChange={(e) => setReason(e.target.value)}>
                <option value="">No preset reason</option>
                {DECLINE_REASONS.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor={`${kind}-message`}>
              Message to the requester <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id={`${kind}-message`}
              rows={3}
              maxLength={800}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={kind === "approve" ? "e.g. The room will be unlocked 15 minutes early." : undefined}
            />
            <p className="text-xs text-muted-foreground">Included in the email and shown on their reservation page.</p>
          </div>
          {kind === "decline" ? (
            <div className="space-y-1.5 rounded-lg border border-dashed p-3">
              <Label htmlFor={`${kind}-note`} className="gap-1.5">
                <Lock className="size-3.5" aria-hidden />
                Private staff note <span className="font-normal text-muted-foreground">(never shared)</span>
              </Label>
              <Textarea id={`${kind}-note`} rows={2} maxLength={2000} value={adminNote} onChange={(e) => setAdminNote(e.target.value)} />
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={pending}>
              Go back
            </Button>
          </DialogClose>
          <Button variant={copy.variant} onClick={submit} disabled={pending}>
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            {pending ? copy.busy : copy.confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReservationActions({
  reservationId,
  reference,
  status,
  size,
  include = ["approve", "decline", "cancel"],
}: {
  reservationId: string;
  reference: string;
  status: "pending" | "approved" | "declined" | "cancelled";
  size?: "default" | "sm";
  include?: Kind[];
}) {
  const kinds = include.filter((k) =>
    k === "cancel" ? status === "pending" || status === "approved" : status === "pending",
  );
  if (kinds.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {kinds.map((k) => (
        <ActionDialog key={k} kind={k} reservationId={reservationId} reference={reference} size={size} />
      ))}
    </div>
  );
}
