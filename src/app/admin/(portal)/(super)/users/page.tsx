import type { Metadata } from "next";

import { UsersManager } from "@/components/admin/users-manager";
import { PageHeader } from "@/components/layout/page-header";
import { requireStaffPage } from "@/lib/auth/guards";
import { formatInstant } from "@/lib/datetime";
import { loadCatalog } from "@/lib/data/catalog";
import { listUsers } from "@/lib/data/super";

export const metadata: Metadata = {
  title: "Users & Roles",
};

export default async function AdminUsersPage() {
  const [me, users, catalog] = await Promise.all([requireStaffPage(), listUsers(), loadCatalog()]);
  const tz = catalog.ok ? catalog.catalog.settings.timeZone : "America/Chicago";

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <PageHeader title="Users & Roles" description="Invite administrators, assign roles, and disable accounts." />
      <UsersManager
        currentUserId={me.id}
        users={users.map((u) => ({
          id: u.id,
          email: u.email,
          fullName: u.full_name,
          role: u.role,
          active: u.active,
          createdLabel: formatInstant(u.created_at, tz, "MMM d, yyyy"),
          lastSignInLabel: u.last_sign_in_at ? formatInstant(u.last_sign_in_at, tz) : "never",
        }))}
      />
    </div>
  );
}
