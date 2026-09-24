import { CalendarRange, Hourglass, Utensils, UtensilsCrossed, UsersRound, Zap, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { formatLongDate, todayInZone } from "@/lib/datetime";
import type { PublicRoom } from "@/lib/data/catalog";
import { advanceLabel, horizonDate } from "@/lib/domain/rooms/advance-booking";
import { APPROVAL_COPY, FOOD_COPY, roomPolicySummary } from "@/lib/domain/rooms/policy";

function Row({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    // dt/dd must be direct children of the row <div> (valid <dl> structure), so the icon
    // sits inside the <dt>, positioned in the left gutter.
    <div className="relative min-h-9 pl-12">
      <dt className="font-medium">
        <span className="absolute top-0 left-0 flex size-9 items-center justify-center rounded-lg bg-secondary text-secondary-foreground">
          <Icon className="size-4.5" aria-hidden />
        </span>
        {title}
      </dt>
      <dd className="text-sm text-muted-foreground">{children}</dd>
    </div>
  );
}

/** Every room rule, stated plainly, before anyone reserves. */
export function RoomPolicyPanel({ room, timeZone }: { room: PublicRoom; timeZone: string }) {
  const lastDate = horizonDate(todayInZone(timeZone), room.advance);
  const approval = room.approvalRequired ? APPROVAL_COPY.required : APPROVAL_COPY.instant;
  const food = room.foodDrinksAllowed ? FOOD_COPY.allowed : FOOD_COPY.notAllowed;

  return (
    <section aria-labelledby="room-policies" className="rounded-xl border bg-card p-5 sm:p-6">
      <h2 id="room-policies" className="text-lg font-semibold">
        Room policies
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {roomPolicySummary({
          capacity: room.capacity,
          approvalRequired: room.approvalRequired,
          foodDrinksAllowed: room.foodDrinksAllowed,
          advance: room.advance,
        })}
      </p>
      <dl className="mt-5 grid gap-5 sm:grid-cols-2">
        <Row icon={UsersRound} title="Capacity">
          Up to {room.capacity} {room.capacity === 1 ? "person" : "people"}
        </Row>
        <Row icon={room.approvalRequired ? Hourglass : Zap} title={approval.label}>
          {approval.description}
        </Row>
        <Row icon={room.foodDrinksAllowed ? Utensils : UtensilsCrossed} title={food.label}>
          {food.notice}
        </Row>
        <Row icon={CalendarRange} title="How far ahead">
          Up to {advanceLabel(room.advance)} in advance — currently through {formatLongDate(lastDate)}.
        </Row>
      </dl>
    </section>
  );
}
