import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Audit Log",
};

export default function AdminAuditPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Audit Log" description="A record of important administrative actions." />
      <UpcomingFeature title="The audit log is on the way">Approvals, cancellations, room changes, role changes and setting changes will be recorded here.</UpcomingFeature>
    </div>
  );
}
