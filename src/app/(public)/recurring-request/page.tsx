import type { Metadata } from "next";

import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { PageHeader } from "@/components/layout/page-header";
import { RecurringRequestForm } from "@/components/reserve/recurring-request-form";
import { loadCatalog } from "@/lib/data/catalog";
import { todayInZone } from "@/lib/datetime";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Request a Recurring Reservation",
  description: "Ask the Stonehill SDA Church team to help arrange a repeating room reservation.",
};

export default async function RecurringRequestPage() {
  const catalog = await loadCatalog();
  return (
    <div className="page-container flex max-w-3xl flex-col gap-8 py-10 sm:py-14">
      <PageHeader
        title="Request recurring dates"
        description="Need the same room more than once? Send the schedule you have in mind and a staff member will follow up. This request does not reserve the dates yet."
      />
      {!catalog.ok ? (
        <CatalogUnavailable reason={catalog.reason} />
      ) : (
        <RecurringRequestForm
          rooms={catalog.catalog.rooms.map(({ id, name }) => ({ id, name }))}
          today={todayInZone(catalog.catalog.settings.timeZone)}
        />
      )}
    </div>
  );
}
