import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Settings",
};

export default function AdminSettingsPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Settings" description="Application-wide settings." />
      <UpcomingFeature title="Settings are on the way">Church details, timezone, default booking rules and email settings will be managed here.</UpcomingFeature>
    </div>
  );
}
