import {
  Accessibility,
  AirVent,
  Armchair,
  Baby,
  Check,
  CircleParking,
  Coffee,
  CookingPot,
  Lightbulb,
  Mic,
  Monitor,
  Music,
  Piano,
  Presentation,
  Printer,
  Projector,
  Refrigerator,
  Sofa,
  Speaker,
  Table,
  Tv,
  Video,
  Wifi,
  type LucideIcon,
} from "lucide-react";

/**
 * Allowlist of icons a Super Admin can assign to an amenity (amenities.icon stores the
 * key). Unknown or missing keys fall back to a checkmark.
 */
export const AMENITY_ICONS = {
  projector: Projector,
  monitor: Monitor,
  tv: Tv,
  speaker: Speaker,
  mic: Mic,
  presentation: Presentation,
  table: Table,
  armchair: Armchair,
  sofa: Sofa,
  "cooking-pot": CookingPot,
  refrigerator: Refrigerator,
  coffee: Coffee,
  piano: Piano,
  music: Music,
  wifi: Wifi,
  video: Video,
  printer: Printer,
  accessibility: Accessibility,
  parking: CircleParking,
  baby: Baby,
  "air-vent": AirVent,
  lightbulb: Lightbulb,
} as const satisfies Record<string, LucideIcon>;

export type AmenityIconKey = keyof typeof AMENITY_ICONS;

export function amenityIcon(key: string | null | undefined): LucideIcon {
  return (key && AMENITY_ICONS[key as AmenityIconKey]) || Check;
}
