import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Notifications",
};

export default function AdminNotificationsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Notifications" description="Updates about reservations that need attention." />
      <UpcomingFeature title="Notifications are on the way">New requests, cancellations and email delivery problems will be listed here.</UpcomingFeature>
    </div>
  );
}
