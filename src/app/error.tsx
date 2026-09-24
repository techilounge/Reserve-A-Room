"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex flex-1 items-center">
      <ErrorState {...props} />
    </main>
  );
}
