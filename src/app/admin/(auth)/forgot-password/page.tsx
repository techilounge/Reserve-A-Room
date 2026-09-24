import type { Metadata } from "next";
import Link from "next/link";

import { ForgotPasswordForm } from "@/components/auth/auth-forms";

export const metadata: Metadata = {
  title: "Reset password",
};

export default function ForgotPasswordPage() {
  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold">Reset your password</h1>
        <p className="text-sm text-muted-foreground">
          Enter your administrator email and we&apos;ll send you a link to choose a new password.
        </p>
      </div>
      <ForgotPasswordForm />
      <Link href="/admin/login" className="block text-sm text-muted-foreground underline-offset-4 hover:underline">
        Back to sign in
      </Link>
    </div>
  );
}
