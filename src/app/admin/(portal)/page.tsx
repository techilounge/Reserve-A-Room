import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Dashboard",
};

export default function AdminDashboardPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Dashboard" description="What needs your attention today." />
      <UpcomingFeature title="The dashboard is on the way">Pending approvals, today&apos;s reservations and this week&apos;s schedule will appear here.</UpcomingFeature>
    </div>
  );
}
