"use client";

import { LoaderCircle, Plus } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { saveMinistryAction } from "@/app/admin/(portal)/(super)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

type Ministry = { id: string; name: string; active: boolean; sort_order: number; reservation_count: number };

function MinistryRow({ ministry }: { ministry: Ministry }) {
  const [name, setName] = useState(ministry.name);
  const [order, setOrder] = useState(String(ministry.sort_order));
  const [active, setActive] = useState(ministry.active);
  const [pending, startTransition] = useTransition();
  const dirty = name !== ministry.name || order !== String(ministry.sort_order) || active !== ministry.active;

  function save() {
    startTransition(async () => {
      const result = await saveMinistryAction({ id: ministry.id, name, active, sortOrder: order });
      if (result.ok) toast.success(result.message);
      else toast.error(result.message);
    });
  }

  return (
    <li className={cn("flex flex-col gap-3 p-4 sm:flex-row sm:items-end", !active && "bg-muted/40")}>
      <div className="flex-1 space-y-1">
        <Label htmlFor={`m-name-${ministry.id}`} className="text-xs text-muted-foreground">
          Name
        </Label>
        <Input id={`m-name-${ministry.id}`} value={name} maxLength={120} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="w-full space-y-1 sm:w-24">
        <Label htmlFor={`m-order-${ministry.id}`} className="text-xs text-muted-foreground">
          Order
        </Label>
        <Input id={`m-order-${ministry.id}`} type="number" inputMode="numeric" min={0} value={order} onChange={(e) => setOrder(e.target.value)} />
      </div>
      <label className="flex min-h-10 items-center gap-2 text-sm sm:w-28">
        <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-[var(--primary)]" />
        Active
      </label>
      <div className="flex items-center gap-3 sm:w-40 sm:justify-end">
        <span className="text-xs text-muted-foreground">
          {ministry.reservation_count} reservation{ministry.reservation_count === 1 ? "" : "s"}
        </span>
        <Button size="sm" variant="secondary" onClick={save} disabled={!dirty || pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
          {pending ? "Saving…" : "Save"}
          <span className="sr-only"> {ministry.name}</span>
        </Button>
      </div>
    </li>
  );
}

export function MinistriesManager({ ministries }: { ministries: Ministry[] }) {
  const [name, setName] = useState("");
  const [pending, startTransition] = useTransition();
  const nextOrder = Math.max(0, ...ministries.map((m) => m.sort_order)) + 10;

  return (
    <div className="flex flex-col gap-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          startTransition(async () => {
            const result = await saveMinistryAction({ id: null, name, active: true, sortOrder: nextOrder });
            if (!result.ok) {
              toast.error(result.message);
              return;
            }
            setName("");
            toast.success(result.message);
          });
        }}
        className="flex flex-col gap-2 rounded-xl border bg-card p-4 sm:flex-row sm:items-end"
      >
        <div className="flex-1 space-y-1">
          <Label htmlFor="new-ministry">Add a ministry or group</Label>
          <Input id="new-ministry" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} placeholder="e.g. Youth Ministry" />
        </div>
        <Button type="submit" disabled={pending || !name.trim()}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : <Plus data-icon="inline-start" aria-hidden />}
          Add
        </Button>
      </form>
      <p className="text-sm text-muted-foreground">
        Inactive ministries are hidden from the reservation form but kept on past reservations. Guests can always choose
        &ldquo;Other / Not Listed&rdquo;.
      </p>
      <ul className="divide-y rounded-xl border bg-card">
        {ministries.map((m) => (
          <MinistryRow key={`${m.id}:${m.name}:${m.active}:${m.sort_order}`} ministry={m} />
        ))}
      </ul>
    </div>
  );
}
