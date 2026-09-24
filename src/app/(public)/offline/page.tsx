import { WifiOff } from "lucide-react";
import type { Metadata } from "next";

import { ReloadWhenOnline } from "@/components/pwa/reload-when-online";

export const metadata: Metadata = {
  title: "You're offline",
  robots: { index: false, follow: false },
};

// Pre-cached by the service worker (public/sw.js) and shown when a page can't load.
export const dynamic = "force-static";

export default function OfflinePage() {
  return (
    <div className="page-container flex flex-1 flex-col items-center justify-center py-16 text-center">
      <span className="flex size-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <WifiOff className="size-7" aria-hidden />
      </span>
      <h1 className="mt-5 font-heading text-2xl font-bold sm:text-3xl">You&apos;re offline</h1>
      <p className="mt-3 max-w-md text-muted-foreground">
        Reserve-A-Room needs an internet connection to show live room availability and to make or manage
        reservations. Nothing is saved or submitted while you&apos;re offline.
      </p>
      <p className="mt-2 max-w-md text-muted-foreground">This page will reload automatically when you&apos;re back online.</p>
      <ReloadWhenOnline />
    </div>
  );
}
