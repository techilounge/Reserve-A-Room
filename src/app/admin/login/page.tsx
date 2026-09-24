import type { Metadata } from "next";
import Link from "next/link";

import { BrandLockup } from "@/components/brand/brand";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Staff sign in",
};

export default function AdminLoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-12">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <BrandLockup />
        <UpcomingFeature title="Staff sign-in is on the way">
          Church staff will sign in here to review and manage reservations. There is no public sign-up.
        </UpcomingFeature>
        <Button asChild variant="outline">
          <Link href="/">Back to Reserve-A-Room</Link>
        </Button>
      </div>
    </main>
  );
}
