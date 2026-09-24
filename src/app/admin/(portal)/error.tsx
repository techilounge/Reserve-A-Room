"use client";

import { ErrorState } from "@/components/feedback/error-state";

export default function AdminError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorState {...props} homeHref="/admin" />;
}
