"use client";

import { CircleCheck, LoaderCircle, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";

import { requestPasswordReset, setPassword, signIn, type AuthFormState } from "@/app/admin/(auth)/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const IDLE: AuthFormState = { status: "idle" };

function FormMessage({ state }: { state: AuthFormState }) {
  if (state.status === "idle" || !state.message) return <div role="status" aria-live="polite" />;
  const ok = state.status === "success";
  const Icon = ok ? CircleCheck : TriangleAlert;
  return (
    <div
      role={ok ? "status" : "alert"}
      className={
        ok
          ? "flex gap-2 rounded-lg border border-success-border bg-success-soft p-3 text-sm text-success-soft-foreground"
          : "flex gap-2 rounded-lg border border-danger-border bg-danger-soft p-3 text-sm text-danger-soft-foreground"
      }
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <p>{state.message}</p>
    </div>
  );
}

function SubmitButton({ pending, idle, busy }: { pending: boolean; idle: string; busy: string }) {
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? <LoaderCircle className="animate-spin" aria-hidden /> : null}
      {pending ? busy : idle}
    </Button>
  );
}

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(signIn, IDLE);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <FormMessage state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus defaultValue={state.email} />
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="password">Password</Label>
          <Link href="/admin/forgot-password" className="text-sm text-muted-foreground underline-offset-4 hover:underline">
            Forgot password?
          </Link>
        </div>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      <SubmitButton pending={pending} idle="Sign in" busy="Signing in…" />
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, IDLE);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="username" required autoFocus defaultValue={state.email} />
      </div>
      <SubmitButton pending={pending} idle="Send reset link" busy="Sending…" />
    </form>
  );
}

export function SetPasswordForm() {
  const [state, action, pending] = useActionState(setPassword, IDLE);
  return (
    <form action={action} className="space-y-4">
      <FormMessage state={state} />
      <div className="space-y-1.5">
        <Label htmlFor="password">New password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          aria-describedby="password-help"
          autoFocus
        />
        <p id="password-help" className="text-sm text-muted-foreground">
          At least 10 characters, including a letter and a number.
        </p>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
      </div>
      <SubmitButton pending={pending} idle="Save password" busy="Saving…" />
    </form>
  );
}
