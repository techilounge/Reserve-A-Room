import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Ministries",
};

export default function AdminMinistriesPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Ministries" description="Ministries and groups guests can choose from." />
      <UpcomingFeature title="Ministry management is on the way">Super Admins will add, rename, reorder and deactivate ministries here.</UpcomingFeature>
    </div>
  );
}
