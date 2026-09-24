"use client";

import { RotateCcw, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/**
 * Friendly fallback for unexpected errors. In production Next.js replaces server error
 * messages with a generic one, so nothing internal is ever shown; only the digest is
 * surfaced so staff can match it to server logs.
 */
export function ErrorState({
  error,
  retry,
  homeHref = "/",
}: {
  error: Error & { digest?: string };
  retry: () => void;
  homeHref?: string;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-danger-soft text-danger-soft-foreground">
        <TriangleAlert className="size-6" aria-hidden />
      </span>
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-muted-foreground">
        We couldn&apos;t load this page. Please try again. If the problem continues, contact the church office.
      </p>
      {error.digest ? (
        <p className="text-xs text-muted-foreground">
          Reference: <code className="font-mono">{error.digest}</code>
        </p>
      ) : null}
      <div className="flex flex-col gap-2 sm:flex-row">
        <Button onClick={() => retry()}>
          <RotateCcw data-icon="inline-start" aria-hidden />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href={homeHref}>Go to home page</Link>
        </Button>
      </div>
    </div>
  );
}
