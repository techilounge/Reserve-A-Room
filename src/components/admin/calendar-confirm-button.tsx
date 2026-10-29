"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

/** The submit button targets its enclosing form even when the dialog is portaled. */
export function CalendarConfirmButton({ formId, label, description, small = false }: {
  formId: string; label: string; description: string; small?: boolean;
}) {
  return <Dialog>
    <DialogTrigger asChild><Button type="button" variant="outline" size={small ? "sm" : "default"}>{label}</Button></DialogTrigger>
    <DialogContent>
      <DialogHeader><DialogTitle>{label}?</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
      <DialogFooter><DialogClose asChild><Button type="button" variant="outline">Cancel</Button></DialogClose>
        <Button type="submit" form={formId}>{label}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
