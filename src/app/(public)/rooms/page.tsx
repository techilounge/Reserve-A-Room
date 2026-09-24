import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Rooms",
  description: "Browse rooms available for Stonehill ministries and groups.",
};

export default function RoomsPage() {
  return (
    <div className="page-container flex flex-col gap-8 py-10 sm:py-14">
      <PageHeader title="Rooms" description="Browse rooms available for Stonehill ministries and groups." />
      <UpcomingFeature title="Room listings are on the way">Each room&apos;s capacity, amenities, food and drinks policy, approval requirement, and how far ahead it can be reserved will be listed here.</UpcomingFeature>
    </div>
  );
}
