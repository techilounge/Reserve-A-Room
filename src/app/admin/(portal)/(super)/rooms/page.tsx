import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Rooms",
};

export default function AdminRoomsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Rooms" description="Rooms and their reservation rules." />
      <UpcomingFeature title="Room management is on the way">Super Admins will add rooms and set capacity, approval requirement, how far ahead each room can be reserved, and the food and drinks policy.</UpcomingFeature>
    </div>
  );
}
