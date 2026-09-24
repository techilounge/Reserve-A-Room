import type { Metadata } from "next";

import { site } from "@/lib/site";

export const metadata: Metadata = {
  title: {
    default: `Admin | ${site.appName}`,
    template: `%s | Admin · ${site.appName}`,
  },
  robots: { index: false, follow: false },
};

export default function AdminRootLayout({ children }: LayoutProps<"/admin">) {
  return children;
}
