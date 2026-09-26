import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Terms governing use of the Stonehill Reserve-A-Room service.",
};

export default function TermsPage() {
  return <LegalDocument document="terms" />;
}
