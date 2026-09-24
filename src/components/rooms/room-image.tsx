import { DoorOpen } from "lucide-react";
import Image from "next/image";

import { cn } from "@/lib/utils";

/** Room photo, or a branded placeholder when no photo has been uploaded. */
export function RoomImage({
  src,
  name,
  sizes,
  priority = false,
  className,
}: {
  src: string | null;
  name: string;
  sizes: string;
  priority?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("relative aspect-[16/9] overflow-hidden bg-hero", className)}>
      {src ? (
        <Image src={src} alt={`Photo of ${name}`} fill sizes={sizes} priority={priority} className="object-cover" />
      ) : (
        <div
          className="flex size-full items-center justify-center bg-[radial-gradient(ellipse_at_top_right,color-mix(in_oklab,var(--brand-gold)_28%,transparent),transparent_65%)]"
          aria-hidden
        >
          <DoorOpen className="size-12 text-hero-foreground/80" strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
