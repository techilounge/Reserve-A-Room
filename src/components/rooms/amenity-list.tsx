import { amenityIcon } from "@/lib/amenity-icons";
import type { Amenity } from "@/lib/data/catalog";
import { cn } from "@/lib/utils";

export function AmenityList({
  amenities,
  limit,
  className,
}: {
  amenities: readonly Amenity[];
  limit?: number;
  className?: string;
}) {
  if (amenities.length === 0) return null;
  const shown = limit ? amenities.slice(0, limit) : amenities;
  const hidden = amenities.length - shown.length;

  return (
    <ul aria-label="Amenities" className={cn("flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-muted-foreground", className)}>
      {shown.map((amenity) => {
        const Icon = amenityIcon(amenity.icon);
        return (
          <li key={amenity.id} className="inline-flex items-center gap-1.5">
            <Icon className="size-4 shrink-0" aria-hidden />
            {amenity.name}
          </li>
        );
      })}
      {hidden > 0 ? <li>+{hidden} more</li> : null}
    </ul>
  );
}
