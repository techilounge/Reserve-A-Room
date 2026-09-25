import type { Metadata } from "next";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { isPasswordSetupOtpType } from "@/lib/auth/setup-link";

import { confirmPasswordSetup } from "./actions";

export const metadata: Metadata = {
  title: "Confirm password setup",
  referrer: "no-referrer",
};

const ERRORS: Record<string, string> = {
  configuration: "Password setup is temporarily unavailable. Please try again in a few minutes.",
  invalid_link: "This password-setup link is incomplete. Please use the complete link from your email.",
  link_expired: "This password-setup link has expired or was already used. Please request a new one.",
};

export default async function ConfirmPasswordSetupPage({ searchParams }: PageProps<"/admin/auth/confirm">) {
  const params = await searchParams;
  const tokenHash = typeof params.token_hash === "string" ? params.token_hash : "";
  const type = typeof params.type === "string" ? params.type : "";
  const error = typeof params.error === "string" ? ERRORS[params.error] : undefined;
  const validLink = tokenHash.length > 0 && isPasswordSetupOtpType(type);

  if (error || !validLink) {
    return (
      <div className="space-y-6">
        <div className="space-y-1.5">
          <h1 className="text-2xl font-bold">We couldn&apos;t confirm this link</h1>
          <p role="alert" className="text-sm text-muted-foreground">
            {error ?? ERRORS.invalid_link}
          </p>
        </div>
        <div className="space-y-3">
          <Button asChild className="w-full" size="lg">
            <Link href="/admin/forgot-password">Request a new link</Link>
          </Button>
          <Link href="/admin/login" className="block text-center text-sm text-muted-foreground underline-offset-4 hover:underline">
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <h1 className="text-2xl font-bold">Continue to choose your password</h1>
        <p className="text-sm text-muted-foreground">
          Confirm below to securely open the password form. This extra step protects one-time links from automated email
          security scanners.
        </p>
      </div>
      <form action={confirmPasswordSetup}>
        <input type="hidden" name="token_hash" value={tokenHash} />
        <input type="hidden" name="type" value={type} />
        <Button type="submit" className="w-full" size="lg">
          Continue securely
        </Button>
      </form>
    </div>
  );
}
