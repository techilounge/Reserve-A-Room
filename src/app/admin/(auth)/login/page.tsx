import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/auth-forms";
import { safeNextPath } from "@/lib/auth/guards";
import { getStaffSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Staff sign in",
};

const NOTICES: Record<string, string> = {
  configuration: "Administrator sign-in is temporarily unavailable because the production connection is not configured.",
  no_access: "Your account doesn't have access to Reserve-A-Room administration. Contact a Super Admin.",
  link_expired: "That link has expired or was already used. Please request a new one.",
};

export default async function AdminLoginPage({ searchParams }: PageProps<"/admin/login">) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);
  const session = await getStaffSession();
  if (session.status === "staff") redirect(next);

  const notice = typeof params.error === "string" ? NOTICES[params.error] : undefined;

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold">Staff sign in</h1>
        <p className="text-sm text-muted-foreground">For church staff who manage room reservations.</p>
      </div>
      {notice ? (
        <p role="alert" className="rounded-lg border border-warning-border bg-warning-soft p-3 text-sm text-warning-soft-foreground">
          {notice}
        </p>
      ) : null}
      {params.signed_out === "1" ? (
        <p role="status" className="rounded-lg border bg-muted p-3 text-sm">
          You&apos;ve been signed out.
        </p>
      ) : null}
      <LoginForm next={next} />
      <p className="text-sm text-muted-foreground">
        Reserving a room? You don&apos;t need an account — just use{" "}
        <Link href="/reserve" className="font-medium text-foreground underline underline-offset-4">
          Reserve a Room
        </Link>
        .
      </p>
    </div>
  );
}
