import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Calendar",
};

export default function AdminCalendarPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Calendar" description="Month, week and day views of every room." />
      <UpcomingFeature title="The calendar is on the way">A schedule of reservations by room, with an agenda view on phones.</UpcomingFeature>
    </div>
  );
}
