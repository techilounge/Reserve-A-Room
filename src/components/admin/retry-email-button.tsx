"use client";

import { LoaderCircle, RotateCw } from "lucide-react";
import { useTransition } from "react";
import { toast } from "sonner";

import { retryEmailAction } from "@/app/admin/(portal)/reservations/actions";
import { Button } from "@/components/ui/button";

export function RetryEmailButton({ reservationId, emailId, label }: { reservationId: string; emailId: string; label: string }) {
  const [pending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      disabled={pending}
      aria-label={`Send again: ${label}`}
      onClick={() =>
        startTransition(async () => {
          const result = await retryEmailAction(reservationId, emailId);
          if (result.ok) toast.success(result.message ?? "Email queued.");
          else toast.error(result.message);
        })
      }
    >
      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <RotateCw aria-hidden />}
      Send again
    </Button>
  );
}
