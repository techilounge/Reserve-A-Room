"use client";

import { Download, PlusSquare, Share, X } from "lucide-react";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { site } from "@/lib/site";

import { promptNativeInstall, rememberDismissal, useInstallMode, wasDismissedRecently } from "./install-store";

/** Pages where a banner would get in the way of a task in progress. */
const QUIET_PATHS = ["/reserve", "/reservation", "/offline"];

function useInstallAction() {
  const mode = useInstallMode();
  const [iosHelpOpen, setIosHelpOpen] = useState(false);
  const install = async () => {
    if (mode === "native") await promptNativeInstall();
    else if (mode === "ios") setIosHelpOpen(true);
  };
  const sheet = <IosInstallSheet open={iosHelpOpen} onOpenChange={setIosHelpOpen} />;
  return { mode, install, sheet };
}

/** A small, dismissible card at the bottom of public pages. Dismissal lasts 30 days. */
export function InstallBanner() {
  const { mode, install, sheet } = useInstallAction();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (mode === "none" || wasDismissedRecently()) return;
    // Let the page settle before offering anything.
    const timer = window.setTimeout(() => setReady(true), 3000);
    return () => window.clearTimeout(timer);
  }, [mode]);

  const quiet = QUIET_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const dismiss = () => {
    rememberDismissal();
    setDismissed(true);
  };

  return (
    <>
      {ready && !dismissed && !quiet && mode !== "none" ? (
        <section
          aria-label="Install app"
          className="fixed inset-x-3 bottom-[calc(5.75rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-xl border bg-card p-3 pr-2 text-card-foreground shadow-lg md:bottom-[max(0.75rem,env(safe-area-inset-bottom))]"
        >
          <Image src={site.logo.mark} alt="" width={40} height={40} className="size-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold">Install this app</p>
            <p className="text-xs text-muted-foreground">Quick access from your home screen.</p>
          </div>
          <Button
            size="sm"
            onClick={() => {
              void install();
              dismiss();
            }}
          >
            {mode === "ios" ? "How to" : "Install"}
          </Button>
          <Button size="icon" variant="ghost" onClick={dismiss} aria-label="Not now">
            <X aria-hidden />
          </Button>
        </section>
      ) : null}
      {sheet}
    </>
  );
}

/** Always-available footer entry (for visitors who dismissed the banner). */
export function InstallFooterButton() {
  const { mode, install, sheet } = useInstallAction();
  if (mode === "none") return null;
  return (
    <>
      <button
        type="button"
        onClick={() => void install()}
        className="inline-flex min-h-6 items-center gap-1.5 text-muted-foreground underline-offset-4 hover:underline"
      >
        <Download className="size-3.5" aria-hidden />
        Install app
      </button>
      {sheet}
    </>
  );
}

function IosInstallSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="mx-auto max-w-lg rounded-t-2xl pb-[max(1.5rem,env(safe-area-inset-bottom))]">
        <SheetHeader>
          <SheetTitle>Add to Home Screen</SheetTitle>
          <SheetDescription>Install Reserve-A-Room on your iPhone or iPad in three steps.</SheetDescription>
        </SheetHeader>
        <ol className="flex flex-col gap-4 px-4 text-sm">
          <li className="flex items-start gap-3">
            <Step n={1} />
            <span>
              Tap the <strong>Share</strong> button{" "}
              <Share className="inline size-4 align-text-bottom" aria-hidden /> in the browser toolbar.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Step n={2} />
            <span>
              Scroll down and tap <strong>Add to Home Screen</strong>{" "}
              <PlusSquare className="inline size-4 align-text-bottom" aria-hidden />.
            </span>
          </li>
          <li className="flex items-start gap-3">
            <Step n={3} />
            <span>
              Tap <strong>Add</strong>. Reserve-A-Room appears on your home screen.
            </span>
          </li>
        </ol>
        <div className="px-4 pt-2">
          <Button className="w-full" variant="secondary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span
      aria-hidden
      className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground"
    >
      {n}
    </span>
  );
}
