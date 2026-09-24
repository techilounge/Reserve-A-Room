import { AccountMenu } from "@/components/admin/account-menu";
import { AdminShell } from "@/components/admin/admin-shell";
import { requireStaffPage } from "@/lib/auth/guards";
import { navigationFor } from "@/lib/navigation";

export const dynamic = "force-dynamic";

const ROLE_LABEL = { admin: "Admin", super_admin: "Super Admin" } as const;

export default async function AdminPortalLayout({ children }: LayoutProps<"/admin">) {
  const profile = await requireStaffPage();
  const allowedHrefs = navigationFor({ kind: "staff", role: profile.role, active: profile.active }).flatMap((g) =>
    g.items.map((i) => i.href),
  );

  return (
    <AdminShell
      allowedHrefs={allowedHrefs}
      headerActions={<AccountMenu name={profile.fullName} email={profile.email} roleLabel={ROLE_LABEL[profile.role]} />}
    >
      {children}
    </AdminShell>
  );
}
