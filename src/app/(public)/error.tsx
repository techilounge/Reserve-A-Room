"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function PublicError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState {...props} />;
}
