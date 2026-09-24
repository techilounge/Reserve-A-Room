import type { Metadata } from "next";

import { PageHeader } from "@/components/layout/page-header";
import { UpcomingFeature } from "@/components/layout/upcoming-feature";

export const metadata: Metadata = {
  title: "Users & Roles",
};

export default function AdminUsersPage() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title="Users & Roles" description="Staff accounts and their roles." />
      <UpcomingFeature title="User management is on the way">Super Admins will invite staff, assign Admin or Super Admin roles, and disable accounts here.</UpcomingFeature>
    </div>
  );
}
