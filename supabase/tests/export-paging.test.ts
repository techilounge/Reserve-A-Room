import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, CHURCH_TZ, createRoom, createStaff, createTestDb } from "./support/db";

// 1,100 reservations: more than one 1,000-row export page, which the small fixtures elsewhere
// can't reach. A dedicated database keeps these counts out of the other suites.
const TOTAL = 1_100;
let db: PGlite;
let admin: string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await createStaff(db, "admin", { email: "export-paging@example.org" });
  const room = await createRoom(db, { slug: "export-paging", max_advance_value: 6, max_advance_unit: "month" });
  // 32 half-hour slots per day (06:00-21:30 starts). Rows go in one at a time and retry on a
  // reference-code collision, exactly as the real booking path does: a day has only a few
  // hundred thousand possible codes, so 1,100 rows can collide.
  for (let n = 0; n < TOTAL; n += 1) {
    for (let attempt = 0; ; attempt += 1) {
      try {
        await db.query(
          `insert into public.reservations (
             reference_code, status, room_id, start_at, end_at,
             requester_first_name, requester_last_name, requester_email, requester_phone,
             other_ministry_name, purpose, estimated_attendance,
             approval_required_at_submission, food_drinks_allowed_at_submission, room_capacity_at_submission,
             guest_token_hash, guest_token_seed)
           select private.generate_reference_code(), 'approved', $1, s.start_at, s.start_at + interval '30 minutes',
             'Bulk', 'Guest', 'bulk@example.org', '+15125550123',
             'Bulk Group', 'Bulk export test ' || $2::int, 10,
             false, false, 0,
             sha256(convert_to(gen_random_uuid()::text, 'UTF8')), uuid_send(gen_random_uuid())
           from (select ((((now() at time zone $3)::date + 1 + ($2::int / 32)) + time '06:00'
             + ($2::int % 32) * interval '30 minutes') at time zone $3) as start_at) s`,
          [room, n, CHURCH_TZ],
        );
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "23505" || attempt >= 20) throw error;
      }
    }
  }
});

const page = (limit: number, offset: number, extra = "") =>
  asRole(
    db,
    "authenticated",
    async (tx) =>
      (
        await tx.query<{ id: string }>(
          `select id from public.admin_export_reservations(p_limit => $1::int, p_offset => $2::int${extra})`,
          [limit, offset],
        )
      ).rows.map((row) => row.id),
    admin,
  );

describe("export paging past one page", () => {
  it("caps a page at 1,000 rows, then continues from the offset", async () => {
    const first = await page(5_000, 0);
    const second = await page(1_000, 1_000);
    expect(first).toHaveLength(1_000);
    expect(second).toHaveLength(TOTAL - 1_000);
    const all = [...first, ...second];
    expect(new Set(all).size).toBe(TOTAL);
    expect(await page(1_000, 2_000)).toHaveLength(0);
  });

  it("returns the same rows in the same order however the result is paged", async () => {
    const [byThousand, byFourHundred] = await Promise.all([
      Promise.all([page(1_000, 0), page(1_000, 1_000)]).then((pages) => pages.flat()),
      Promise.all([page(400, 0), page(400, 400), page(400, 800)]).then((pages) => pages.flat()),
    ]);
    expect(byFourHundred).toEqual(byThousand);
    expect(byThousand).toHaveLength(TOTAL);
  });
});
