import "server-only";

import { unstable_cache } from "next/cache";

import { normalizeTime, type LocalTime } from "@/lib/datetime";
import { effectiveAdvanceRule, type AdvanceRule } from "@/lib/domain/rooms/advance-booking";
import { isSupabaseConfigured } from "@/lib/env/public";
import type { Tables } from "@/lib/supabase/database.types";
import { createSupabasePublicClient, roomImageUrl } from "@/lib/supabase/public";

/** Cache tag for rooms/ministries/amenities/settings. Revalidated when Super Admins edit them. */
export const CATALOG_TAG = "catalog";

export type Amenity = Pick<Tables<"amenities">, "id" | "name" | "icon">;

export type PublicRoom = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  location: string | null;
  capacity: number;
  imageUrl: string | null;
  reservable: boolean;
  unavailableMessage: string | null;
  approvalRequired: boolean;
  foodDrinksAllowed: boolean;
  advance: AdvanceRule;
  amenities: Amenity[];
};

export type PublicSettings = {
  churchName: string;
  appName: string;
  timeZone: string;
  contactEmail: string | null;
  contactPhone: string | null;
  intervalMinutes: number;
  leadMinutes: number;
  dayStart: LocalTime;
  dayEnd: LocalTime;
  allowGuestCancellation: boolean;
  defaultAdvance: AdvanceRule;
};

export type Ministry = Pick<Tables<"ministries">, "id" | "name">;

export type Catalog = {
  settings: PublicSettings;
  rooms: PublicRoom[];
  ministries: Ministry[];
};

export type CatalogResult =
  | { ok: true; catalog: Catalog }
  | { ok: false; reason: "not_configured" | "unavailable" };

async function fetchCatalog(): Promise<Catalog> {
  const supabase = createSupabasePublicClient();

  const [settingsResult, roomsResult, ministriesResult] = await Promise.all([
    supabase
      .from("app_settings")
      .select(
        "church_name, app_name, timezone, contact_email, contact_phone, booking_interval_minutes, min_lead_time_minutes, bookable_day_start, bookable_day_end, allow_guest_cancellation, default_max_advance_value, default_max_advance_unit",
      )
      .single(),
    supabase
      .from("rooms")
      .select(
        "id, name, slug, description, location, capacity, image_path, reservable, unavailable_message, approval_required, food_drinks_allowed, max_advance_value, max_advance_unit, sort_order, room_amenities(amenities(id, name, icon, sort_order, active))",
      )
      .eq("active", true)
      .order("sort_order")
      .order("name"),
    supabase.from("ministries").select("id, name").eq("active", true).order("sort_order").order("name"),
  ]);

  if (settingsResult.error) throw settingsResult.error;
  if (roomsResult.error) throw roomsResult.error;
  if (ministriesResult.error) throw ministriesResult.error;

  const s = settingsResult.data;
  const settings: PublicSettings = {
    churchName: s.church_name,
    appName: s.app_name,
    timeZone: s.timezone,
    contactEmail: s.contact_email,
    contactPhone: s.contact_phone,
    intervalMinutes: s.booking_interval_minutes,
    leadMinutes: s.min_lead_time_minutes,
    dayStart: normalizeTime(s.bookable_day_start),
    dayEnd: normalizeTime(s.bookable_day_end),
    allowGuestCancellation: s.allow_guest_cancellation,
    defaultAdvance: { value: s.default_max_advance_value, unit: s.default_max_advance_unit },
  };

  const rooms: PublicRoom[] = roomsResult.data.map((room) => ({
    id: room.id,
    name: room.name,
    slug: room.slug,
    description: room.description,
    location: room.location,
    capacity: room.capacity,
    imageUrl: roomImageUrl(room.image_path),
    reservable: room.reservable,
    unavailableMessage: room.unavailable_message,
    approvalRequired: room.approval_required,
    foodDrinksAllowed: room.food_drinks_allowed,
    advance: effectiveAdvanceRule(room, s),
    amenities: room.room_amenities
      .map((ra) => ra.amenities)
      .filter((a): a is NonNullable<typeof a> => Boolean(a?.active))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
      .map(({ id, name, icon }) => ({ id, name, icon })),
  }));

  return { settings, rooms, ministries: ministriesResult.data };
}

const getCachedCatalog = unstable_cache(fetchCatalog, ["public-catalog-v1"], {
  tags: [CATALOG_TAG],
  revalidate: 300,
});

/**
 * Public rooms, ministries and settings. Never throws: pages render a friendly state
 * when Supabase isn't configured yet or can't be reached.
 */
export async function loadCatalog(): Promise<CatalogResult> {
  if (!isSupabaseConfigured()) return { ok: false, reason: "not_configured" };
  try {
    return { ok: true, catalog: await getCachedCatalog() };
  } catch (error) {
    console.error("[catalog] failed to load rooms/settings", error);
    return { ok: false, reason: "unavailable" };
  }
}

export function findRoom(catalog: Catalog, slug: string): PublicRoom | undefined {
  return catalog.rooms.find((room) => room.slug === slug);
}
