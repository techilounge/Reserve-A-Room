import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { SetPasswordForm } from "@/components/auth/auth-forms";
import { getStaffSession } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Choose a password",
};

export default async function SetPasswordPage() {
  const session = await getStaffSession();
  if (session.status === "signed_out") redirect("/admin/login?error=link_expired");

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold">Choose a password</h1>
        <p className="text-sm text-muted-foreground">
          {session.status === "staff" ? `Signed in as ${session.profile.email}.` : "Set a password for your account."}
        </p>
      </div>
      <SetPasswordForm />
    </div>
  );
}
