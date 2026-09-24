import type { Metadata } from "next";

import { MinistriesManager } from "@/components/admin/ministries-manager";
import { PageHeader } from "@/components/layout/page-header";
import { listMinistries } from "@/lib/data/super";

export const metadata: Metadata = {
  title: "Ministries",
};

export default async function AdminMinistriesPage() {
  const ministries = await listMinistries();
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <PageHeader title="Ministries" description="The ministries and groups guests choose from when reserving a room." />
      <MinistriesManager ministries={ministries} />
    </div>
  );
}
