"use client";

import { LoaderCircle, ShieldCheck, UserPlus, UserRound } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { inviteUserAction, setUserActiveAction, setUserRoleAction } from "@/app/admin/(portal)/(super)/actions";
import { PolicyPill } from "@/components/rooms/policy-badges";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";

export type ManagedUser = {
  id: string;
  email: string;
  fullName: string;
  role: "admin" | "super_admin";
  active: boolean;
  createdLabel: string;
  lastSignInLabel: string;
};

function InviteDialog() {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ fullName: "", email: "", role: "admin" as "admin" | "super_admin" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  return (
    <Dialog open={open} onOpenChange={(v) => !pending && setOpen(v)}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus data-icon="inline-start" aria-hidden />
          Invite user
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            setErrors({});
            setMessage(null);
            startTransition(async () => {
              const result = await inviteUserAction(form);
              if (!result.ok) {
                setMessage(result.message);
                setErrors(result.fieldErrors ?? {});
                return;
              }
              toast.success(result.message);
              setForm({ fullName: "", email: "", role: "admin" });
              setOpen(false);
            });
          }}
          className="space-y-4"
        >
          <DialogHeader>
            <DialogTitle>Invite an administrator</DialogTitle>
            <DialogDescription>They&apos;ll get an email with a link to choose a password.</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="invite-name">Full name</Label>
            <Input id="invite-name" value={form.fullName} maxLength={120} aria-invalid={Boolean(errors.fullName) || undefined} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            {errors.fullName ? <p className="text-sm text-destructive">{errors.fullName}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-email">Email</Label>
            <Input id="invite-email" type="email" value={form.email} aria-invalid={Boolean(errors.email) || undefined} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            {errors.email ? <p className="text-sm text-destructive">{errors.email}</p> : null}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="invite-role">Role</Label>
            <NativeSelect id="invite-role" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "super_admin" })}>
              <option value="admin">Admin — manages reservations</option>
              <option value="super_admin">Super Admin — also rooms, users and settings</option>
            </NativeSelect>
          </div>
          {message ? (
            <p role="alert" className="text-sm font-medium text-destructive">
              {message}
            </p>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
              {pending ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function UserRow({ user, isSelf }: { user: ManagedUser; isSelf: boolean }) {
  const [pending, startTransition] = useTransition();
  const disableProtected = user.active && user.role === "super_admin";
  const guidanceId = `disable-guidance-${user.id}`;
  const run = (fn: () => Promise<{ ok: boolean; message: string }>) =>
    startTransition(async () => {
      const result = await fn();
      if (result.ok) toast.success(`${user.fullName}: ${result.message}`);
      else toast.error(result.message);
    });

  return (
    <li className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-secondary text-secondary-foreground">
          {user.role === "super_admin" ? <ShieldCheck className="size-5" aria-hidden /> : <UserRound className="size-5" aria-hidden />}
        </span>
        <div className="min-w-0">
          <p className="font-medium">
            {user.fullName}
            {isSelf ? <span className="ml-2 text-xs font-normal text-muted-foreground">(you)</span> : null}
          </p>
          <p className="truncate text-sm text-muted-foreground">{user.email}</p>
          <p className="text-xs text-muted-foreground">
            Added {user.createdLabel} · Last sign-in {user.lastSignInLabel}
          </p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {!user.active ? (
          <PolicyPill icon={UserRound} tone="neutral">
            Disabled
          </PolicyPill>
        ) : null}
        <label className="sr-only" htmlFor={`role-${user.id}`}>
          Role for {user.fullName}
        </label>
        <NativeSelect
          id={`role-${user.id}`}
          className="w-40"
          value={user.role}
          disabled={pending}
          onChange={(e) => run(() => setUserRoleAction(user.id, e.target.value as "admin" | "super_admin"))}
        >
          <option value="admin">Admin</option>
          <option value="super_admin">Super Admin</option>
        </NativeSelect>
        <div className="flex flex-col items-start gap-1">
          <Button
            size="sm"
            variant={user.active ? "outline" : "secondary"}
            disabled={pending || disableProtected}
            aria-describedby={disableProtected ? guidanceId : undefined}
            onClick={() => {
              if (user.active && !window.confirm(`Disable ${user.fullName}? They will be signed out and can't sign in until re-enabled.`)) return;
              run(() => setUserActiveAction(user.id, !user.active));
            }}
          >
            {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
            {user.active ? "Disable" : "Re-enable"}
            <span className="sr-only"> {user.fullName}</span>
          </Button>
          {disableProtected ? (
            <p id={guidanceId} className="max-w-48 text-xs text-muted-foreground">
              Demote to Admin before disabling this account.
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

export function UsersManager({ users, currentUserId }: { users: ManagedUser[]; currentUserId: string }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Super Admins must be demoted to Admin before they can be disabled. At least one active Super Admin is always required.
        </p>
        <InviteDialog />
      </div>
      <ul className="divide-y rounded-xl border bg-card">
        {users.map((u) => (
          <UserRow key={`${u.id}:${u.role}:${u.active}`} user={u} isSelf={u.id === currentUserId} />
        ))}
      </ul>
    </div>
  );
}
