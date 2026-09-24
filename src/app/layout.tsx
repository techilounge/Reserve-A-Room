import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";

import { ServiceWorkerRegistration } from "@/components/pwa/service-worker";
import { ThemeProvider } from "@/components/theme/theme-provider";
import { Toaster } from "@/components/ui/sonner";
import { getAppUrl } from "@/lib/app-url";
import { site } from "@/lib/site";

import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: getAppUrl(),
  title: {
    default: site.title,
    template: `%s | ${site.appName} · ${site.churchShortName}`,
  },
  description: site.description,
  applicationName: site.appName,
  formatDetection: { telephone: false },
  appleWebApp: { capable: true, title: site.appName, statusBarStyle: "default" },
  openGraph: {
    type: "website",
    siteName: `${site.appName} · ${site.churchShortName}`,
    title: site.title,
    description: site.description,
    locale: "en_US",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#051328" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // suppressHydrationWarning: next-themes sets the theme class before React hydrates.
    <html lang="en" suppressHydrationWarning className={`${inter.variable} ${jakarta.variable} antialiased`}>
      <body className="flex min-h-dvh flex-col">
        <ThemeProvider>
          {children}
          <Toaster position="top-center" richColors closeButton />
          <ServiceWorkerRegistration />
        </ThemeProvider>
      </body>
    </html>
  );
}
