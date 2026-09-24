"use client";

import { RotateCcw } from "lucide-react";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Reloads the page the visitor was trying to open as soon as the connection returns. */
export function ReloadWhenOnline() {
  useEffect(() => {
    const reload = () => window.location.reload();
    window.addEventListener("online", reload);
    return () => window.removeEventListener("online", reload);
  }, []);

  return (
    <Button className="mt-6" onClick={() => window.location.reload()}>
      <RotateCcw data-icon="inline-start" aria-hidden />
      Try again
    </Button>
  );
}
