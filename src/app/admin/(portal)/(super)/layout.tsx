import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { EmptyState } from "@/components/feedback/empty-state";
import { Button } from "@/components/ui/button";
import { hasPermission } from "@/lib/auth/guards";

/**
 * Super Admin section. Admins who type these URLs see an explanation instead of the page;
 * every Super Admin action and RLS policy re-checks the role independently.
 */
export default async function SuperAdminLayout({ children }: LayoutProps<"/admin">) {
  if (!(await hasPermission("rooms.manage"))) {
    return (
      <EmptyState
        icon={ShieldAlert}
        title="Super Admin access required"
        action={
          <Button asChild variant="outline">
            <Link href="/admin">Back to dashboard</Link>
          </Button>
        }
      >
        This section is available to Super Admins only. If you need access, ask a Super Admin.
      </EmptyState>
    );
  }
  return children;
}
