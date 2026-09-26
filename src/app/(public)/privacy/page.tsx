import type { Metadata } from "next";

import { LegalDocument } from "@/components/legal/legal-document";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy practices for the Stonehill Reserve-A-Room service.",
};

export default function PrivacyPage() {
  return <LegalDocument document="privacy" />;
}
