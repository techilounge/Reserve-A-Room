import type { Metadata } from "next";

import { CatalogUnavailable } from "@/components/feedback/catalog-unavailable";
import { PageHeader } from "@/components/layout/page-header";
import { RecurringRequestForm } from "@/components/reserve/recurring-request-form";
import { timeGrid } from "@/lib/availability-query";
import { loadCatalog } from "@/lib/data/catalog";
import { todayInZone } from "@/lib/datetime";
import { getTurnstileSiteKey } from "@/lib/env/public";
import { isTurnstileEnabled } from "@/lib/security/turnstile";

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
          rooms={catalog.catalog.rooms.map(({ id, name, capacity }) => ({ id, name, capacity }))}
          today={todayInZone(catalog.catalog.settings.timeZone)}
          turnstileSiteKey={isTurnstileEnabled() ? getTurnstileSiteKey() : null}
          timeOptions={timeGrid(
            catalog.catalog.settings.dayStart,
            catalog.catalog.settings.dayEnd,
            catalog.catalog.settings.intervalMinutes,
          )}
        />
      )}
    </div>
  );
}
