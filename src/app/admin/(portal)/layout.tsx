import { AdminShell } from "@/components/admin/admin-shell";
import { ADMIN_NAV } from "@/lib/navigation";

/*
 * Phase 1: layout only. There is no authentication yet and these pages contain no data.
 * Phase 5 adds the session/role guard here and replaces `allHrefs` with the items from
 * navigationFor(actor) for the signed-in user.
 */
const allHrefs = ADMIN_NAV.flatMap((group) => group.items.map((item) => item.href));

export default function AdminPortalLayout({ children }: LayoutProps<"/admin">) {
  return <AdminShell allowedHrefs={allHrefs}>{children}</AdminShell>;
}
