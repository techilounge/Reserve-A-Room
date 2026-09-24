import { CloudOff, Settings2 } from "lucide-react";

import { site } from "@/lib/site";

/** Shown when rooms can't be loaded — never a raw error. */
export function CatalogUnavailable({ reason }: { reason: "not_configured" | "unavailable" }) {
  const Icon = reason === "not_configured" ? Settings2 : CloudOff;
  return (
    <div role="status" className="flex flex-col items-center gap-3 rounded-xl border border-dashed bg-card px-6 py-12 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-neutral-soft text-neutral-soft-foreground">
        <Icon className="size-6" aria-hidden />
      </span>
      <h2 className="text-lg font-semibold">
        {reason === "not_configured" ? "Online reservations are being set up" : "Rooms couldn't be loaded"}
      </h2>
      <p className="max-w-md text-sm text-muted-foreground">
        {reason === "not_configured"
          ? "Room information will appear here soon."
          : "Please refresh the page in a moment."}{" "}
        For help, visit{" "}
        <a href={site.churchWebsite} className="font-medium text-foreground underline underline-offset-4">
          {site.churchWebsiteLabel}
        </a>
        .
      </p>
    </div>
  );
}
