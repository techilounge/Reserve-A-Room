import { ExternalLink } from "lucide-react";
import Link from "next/link";

import { BrandLogo } from "@/components/brand/brand";
import { InstallFooterButton } from "@/components/pwa/install-prompt";
import { site } from "@/lib/site";

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t bg-card">
      <div className="page-container flex flex-col gap-6 py-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-3">
          <div className="w-44">
            <BrandLogo sizes="11rem" />
          </div>
          <p className="max-w-sm text-sm text-muted-foreground">{site.churchName}</p>
        </div>
        <nav aria-label="Footer" className="flex flex-col gap-3 text-sm sm:items-end">
          <a
            href={site.churchWebsite}
            className="inline-flex min-h-6 items-center gap-1.5 font-medium text-foreground underline-offset-4 hover:underline"
          >
            {site.churchWebsiteLabel}
            <ExternalLink className="size-3.5" aria-hidden />
          </a>
          <Link
            href="/admin/login"
            className="inline-flex min-h-6 items-center text-muted-foreground underline-offset-4 hover:underline"
          >
            Staff sign in
          </Link>
          <InstallFooterButton />
          <p className="text-muted-foreground">
            © {new Date().getFullYear()} {site.churchShortName}
          </p>
        </nav>
      </div>
    </footer>
  );
}
