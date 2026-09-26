import type { PGlite, Transaction } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, CHURCH_TZ, createRoom, createStaff, createTestDb, insertReservation } from "./support/db";

type ScheduleDate = { date: string; startAt: string; endAt: string };

let db: PGlite;
let admin: string;
let disabledAdmin: string;
let room: string;
let conflictRoom: string;
let workerRoom: string;
let pauseRoom: string;
let dates: ScheduleDate[];

beforeAll(async () => {
  db = await createTestDb();
  admin = await createStaff(db, "admin", { email: "series-admin@example.org" });
  await createStaff(db, "super_admin", { email: "series-super@example.org" });
  disabledAdmin = await createStaff(db, "admin", { active: false, email: "series-disabled@example.org" });
  room = await createRoom(db, { slug: "series-room", max_advance_value: 12, max_advance_unit: "week" });
  conflictRoom = await createRoom(db, { slug: "series-conflict", max_advance_value: 12, max_advance_unit: "week" });
  workerRoom = await createRoom(db, { slug: "series-worker", max_advance_value: 12, max_advance_unit: "week" });
  pauseRoom = await createRoom(db, { slug: "series-pause", max_advance_value: 12, max_advance_unit: "week" });

  const { rows } = await db.query<ScheduleDate>(
    `with first_saturday as (
       select ((now() at time zone $1)::date
         + ((6 - extract(dow from (now() at time zone $1)::date)::integer + 7) % 7)
         + 7)::date as d
     )
     select (d + n * 7)::text as date,
       (((d + n * 7) + time '14:00') at time zone $1)::text as "startAt",
       (((d + n * 7) + time '15:00') at time zone $1)::text as "endAt"
     from first_saturday cross join generate_series(0, 8) n`,
    [CHURCH_TZ],
  );
  dates = rows;
});

const asAdmin = <T>(fn: (tx: Transaction) => Promise<T>, user = admin) => asRole(db, "authenticated", fn, user);

function occurrences(which: readonly ScheduleDate[]) {
  return which.map((item, index) => ({
    occurrence_date: item.date,
    start_at: item.startAt,
    end_at: item.endAt,
    token_hash: (index + 1).toString(16).padStart(2, "0").repeat(32),
    token_seed: (index + 11).toString(16).padStart(2, "0").repeat(16),
  }));
}

async function createSeries(
  seriesRoom: string,
  selected: readonly ScheduleDate[],
  options: {
    user?: string;
    endDate?: string | null;
    materializedThrough?: string;
    occurrencePayload?: ReturnType<typeof occurrences>;
    notify?: boolean;
  } = {},
) {
  const payload = JSON.stringify(options.occurrencePayload ?? occurrences(selected));
  const user = options.user ?? admin;
  const [row] = await asAdmin(
    async (tx) =>
      (
        await tx.query<{ series_id: string; occurrence_count: number }>(
          `select * from public.create_recurring_reservation_series(
             p_room_id => $1,
             p_frequency => 'weekly',
             p_interval_count => 1::smallint,
             p_weekdays => array[6]::smallint[],
             p_weekday => null::smallint,
             p_month_ordinals => '{}'::smallint[],
             p_month_ordinal => null::smallint,
             p_day_of_month => null::smallint,
             p_month_of_year => null::smallint,
             p_instance_limit => 50::smallint,
             p_start_date => $2::date,
             p_end_date => $3::date,
             p_local_start_time => '14:00'::time,
             p_local_end_time => '15:00'::time,
             p_timezone => $4,
             p_first_name => 'Katherine',
             p_last_name => 'Johnson',
             p_email => 'katherine@example.org',
             p_phone => '+15125550199',
             p_purpose => 'Weekly ministry planning',
             p_estimated_attendance => 12,
             p_occurrences => $5::jsonb,
             p_materialized_through => $6::date,
             p_other_ministry_name => 'Church Board',
             p_notify => $7
           )`,
          [
            seriesRoom,
            selected[0].date,
            options.endDate ?? null,
            CHURCH_TZ,
            payload,
            options.materializedThrough ?? selected.at(-1)!.date,
            options.notify ?? true,
          ],
        )
      ).rows,
    user,
  );
  return row;
}

describe("atomic recurring-series creation", () => {
  let seriesId: string;

  it("creates typed series data and linked approved reservations in one transaction", async () => {
    const result = await createSeries(room, dates.slice(0, 3));
    seriesId = result.series_id;
    expect(Number(result.occurrence_count)).toBe(3);

    const series = await db.query<Record<string, unknown>>(
      "select status, frequency, interval_count, weekdays, weekday, month_ordinals, month_ordinal, instance_limit, timezone, materialized_through::text from public.reservation_series where id = $1",
      [seriesId],
    );
    expect(series.rows[0]).toMatchObject({
      status: "active",
      frequency: "weekly",
      interval_count: 1,
      weekdays: [6],
      weekday: null,
      month_ordinals: [],
      month_ordinal: null,
      instance_limit: 50,
      timezone: CHURCH_TZ,
      materialized_through: dates[2].date,
    });

    const linked = await db.query<Record<string, unknown>>(
      "select status, source, series_id, occurrence_date::text, created_by_user_id, approval_required_at_submission, food_drinks_allowed_at_submission, room_capacity_at_submission from public.reservations where series_id = $1 order by occurrence_date",
      [seriesId],
    );
    expect(linked.rows).toHaveLength(3);
    expect(linked.rows.every((row) => row.status === "approved" && row.source === "admin")).toBe(true);
    expect(linked.rows.map((row) => row.occurrence_date)).toEqual(dates.slice(0, 3).map((item) => item.date));
    expect(linked.rows.every((row) => row.created_by_user_id === admin)).toBe(true);
    expect(
      linked.rows.every(
        (row) =>
          row.approval_required_at_submission === true &&
          row.food_drinks_allowed_at_submission === true &&
          row.room_capacity_at_submission === 20,
      ),
    ).toBe(true);

    const emails = await db.query("select id from public.email_logs where reservation_id in (select id from public.reservations where series_id = $1)", [seriesId]);
    expect(emails.rows).toHaveLength(0);
    const systemEmails = await db.query<{ event_type: string; recipient: string; status: string }>(
      "select event_type, recipient, status from public.system_email_logs where entity_id = $1",
      [seriesId],
    );
    expect(systemEmails.rows).toEqual([{ event_type: "recurring_series_created", recipient: "katherine@example.org", status: "queued" }]);
    const audit = await db.query<{ metadata: { occurrence_count: number } }>(
      "select metadata from public.audit_logs where action = 'reservation_series.created' and entity_id = $1",
      [seriesId],
    );
    expect(audit.rows[0].metadata.occurrence_count).toBe(3);
  });

  it("does not queue a series summary when staff turns requester email off", async () => {
    const noEmailRoom = await createRoom(db, { slug: "series-no-email", max_advance_value: 12, max_advance_unit: "week" });
    const result = await createSeries(noEmailRoom, dates.slice(0, 1), { notify: false });
    expect((await db.query("select id from public.system_email_logs where entity_id = $1", [result.series_id])).rows).toHaveLength(0);
  });

  it("keeps the generic outbox service-role only and exposes a complete series context", async () => {
    await expect(
      asAdmin((tx) => tx.query("select * from public.claim_system_emails(10, $1)", [seriesId])),
    ).rejects.toMatchObject({ code: "42501" });

    const claimed = await asRole(db, "service_role", async (tx) =>
      (await tx.query<{ id: string }>("select public.claim_system_emails(10, $1) as id", [seriesId])).rows,
    );
    expect(claimed).toHaveLength(1);
    const [context] = await asRole(db, "service_role", async (tx) =>
      (
        await tx.query<{ context: { event_type: string; series: { id: string }; occurrences: unknown[] } }>(
          "select public.system_email_context($1) as context",
          [claimed[0].id],
        )
      ).rows,
    );
    expect(context.context.event_type).toBe("recurring_series_created");
    expect(context.context.series.id).toBe(seriesId);
    expect(context.context.occurrences).toHaveLength(3);

    await asRole(db, "service_role", (tx) =>
      tx.query("select public.complete_system_email($1, 'failed'::public.email_status, null, 'temporary failure')", [claimed[0].id]),
    );
    const retried = await asRole(db, "service_role", async (tx) =>
      (await tx.query<{ id: string }>("select public.claim_system_emails(10, $1) as id", [seriesId])).rows,
    );
    expect(retried).toEqual([{ id: claimed[0].id }]);
    await asRole(db, "service_role", (tx) =>
      tx.query("select public.complete_system_email($1, 'skipped'::public.email_status)", [claimed[0].id]),
    );
    expect(
      (await db.query<{ status: string }>("select status from public.system_email_logs where id = $1", [claimed[0].id])).rows[0]
        .status,
    ).toBe("skipped");
  });

  it("returns a staff-safe aggregate and ends future generation without cancelling occurrences", async () => {
    const [detail] = await asAdmin(async (tx) => (await tx.query<{ admin_get_reservation_series: Record<string, unknown> }>(
      "select public.admin_get_reservation_series($1)",
      [seriesId],
    )).rows);
    expect((detail.admin_get_reservation_series.occurrences as unknown[])).toHaveLength(3);

    const [ended] = await asAdmin(async (tx) => (await tx.query<{ ended: boolean }>(
      "select public.admin_end_reservation_series($1) as ended",
      [seriesId],
    )).rows);
    expect(ended.ended).toBe(true);
    expect((await db.query<{ status: string }>("select status from public.reservation_series where id = $1", [seriesId])).rows[0].status).toBe("ended");
    expect((await db.query("select id from public.reservations where series_id = $1", [seriesId])).rows).toHaveLength(3);
    const [again] = await asAdmin(async (tx) => (await tx.query<{ ended: boolean }>(
      "select public.admin_end_reservation_series($1) as ended",
      [seriesId],
    )).rows);
    expect(again.ended).toBe(false);
  });

  it("rolls back the series and every occurrence when any initial date conflicts", async () => {
    await insertReservation(db, {
      roomId: conflictRoom,
      startAt: dates[1].startAt,
      endAt: dates[1].endAt,
      status: "approved",
    });
    await expect(createSeries(conflictRoom, dates.slice(0, 3))).rejects.toMatchObject({ code: "23P01" });
    expect((await db.query("select id from public.reservation_series where room_id = $1", [conflictRoom])).rows).toHaveLength(0);
  });
});

describe("authorization and invariants", () => {
  it("allows active staff reads but blocks guests, disabled staff, and direct writes", async () => {
    expect(await asAdmin(async (tx) => (await tx.query("select id from public.reservation_series")).rows)).toBeDefined();
    await expect(asRole(db, "anon", (tx) => tx.query("select id from public.reservation_series"))).rejects.toMatchObject({ code: "42501" });
    expect(
      await asAdmin(async (tx) => (await tx.query("select id from public.reservation_series")).rows, disabledAdmin),
    ).toHaveLength(0);
    await expect(createSeries(await createRoom(db), dates.slice(0, 1), { user: disabledAdmin })).rejects.toMatchObject({ code: "RAR09" });
    await expect(asAdmin((tx) => tx.query("update public.reservation_series set status = 'ended'"))).rejects.toMatchObject({ code: "42501" });
  });

  it("rejects malformed rules, wall-clock mismatches, and more than one year", async () => {
    const wrongTime = occurrences(dates.slice(0, 1));
    wrongTime[0].start_at = dates[0].endAt;
    const tooLate = `${Number(dates[0].date.slice(0, 4)) + 2}${dates[0].date.slice(4)}`;
    await expect(createSeries(await createRoom(db), dates.slice(0, 1), { endDate: tooLate })).rejects.toBeTruthy();
    await expect(
      createSeries(await createRoom(db), dates.slice(0, 1), { occurrencePayload: wrongTime }),
    ).rejects.toMatchObject({ code: "RAR10" });
  });

  it("matches all recurrence families in SQL", async () => {
    const { rows } = await db.query<Record<string, boolean>>(
      `select
         private.recurrence_date_matches('daily'::text, 3::smallint, '{}'::smallint[], null::smallint, '{}'::smallint[], null::smallint, null::smallint, null::smallint, '2026-01-01'::date, null::date, '2026-01-07'::date) as daily_ok,
         private.recurrence_date_matches('weekdays'::text, 1::smallint, '{}'::smallint[], null::smallint, '{}'::smallint[], null::smallint, null::smallint, null::smallint, '2026-01-01'::date, null::date, '2026-01-05'::date) as weekday_ok,
         private.recurrence_date_matches('weekdays'::text, 1::smallint, '{}'::smallint[], null::smallint, '{}'::smallint[], null::smallint, null::smallint, null::smallint, '2026-01-01'::date, null::date, '2026-01-04'::date) as weekend_wrong,
         private.recurrence_date_matches('weekly'::text, 2::smallint, array[1,3]::smallint[], null::smallint, '{}'::smallint[], null::smallint, null::smallint, null::smallint, '2026-09-30'::date, null::date, '2026-10-12'::date) as weekly_ok,
         private.recurrence_date_matches('weekly'::text, 2::smallint, array[1,3]::smallint[], null::smallint, '{}'::smallint[], null::smallint, null::smallint, null::smallint, '2026-09-30'::date, null::date, '2026-10-05'::date) as weekly_wrong,
         private.recurrence_date_matches('monthly_day'::text, 3::smallint, '{}'::smallint[], null::smallint, '{}'::smallint[], null::smallint, 15::smallint, null::smallint, '2026-01-01'::date, null::date, '2026-04-15'::date) as month_day_ok,
         private.recurrence_date_matches('monthly_nth_weekday'::text, 1::smallint, '{}'::smallint[], 6::smallint, array[2,4]::smallint[], null::smallint, null::smallint, null::smallint, '2026-01-01'::date, null::date, '2026-10-10'::date) as month_second_ok,
         private.recurrence_date_matches('monthly_nth_weekday'::text, 1::smallint, '{}'::smallint[], 6::smallint, array[2,4]::smallint[], null::smallint, null::smallint, null::smallint, '2026-01-01'::date, null::date, '2026-10-24'::date) as month_fourth_ok,
         private.recurrence_date_matches('monthly_nth_weekday'::text, 1::smallint, '{}'::smallint[], 6::smallint, array[-1]::smallint[], null::smallint, null::smallint, null::smallint, '2026-01-01'::date, null::date, '2026-10-31'::date) as month_last_ok,
         private.recurrence_date_matches('yearly_date'::text, 1::smallint, '{}'::smallint[], null::smallint, '{}'::smallint[], null::smallint, 25::smallint, 12::smallint, '2026-01-01'::date, null::date, '2026-12-25'::date) as yearly_date_ok,
         private.recurrence_date_matches('yearly_nth_weekday'::text, 1::smallint, '{}'::smallint[], 4::smallint, '{}'::smallint[], 4::smallint, null::smallint, 11::smallint, '2026-01-01'::date, null::date, '2026-11-26'::date) as yearly_ordinal_ok`,
    );
    expect(rows[0]).toEqual({
      daily_ok: true,
      weekday_ok: true,
      weekend_wrong: false,
      weekly_ok: true,
      weekly_wrong: false,
      month_day_ok: true,
      month_second_ok: true,
      month_fourth_ok: true,
      month_last_ok: true,
      yearly_date_ok: true,
      yearly_ordinal_ok: true,
    });
  });
});

describe("rolling materialization", () => {
  it("claims due series only for the service role, records conflicts, and continues later dates", async () => {
    const created = await createSeries(workerRoom, dates.slice(0, 1));
    await expect(asAdmin((tx) => tx.query("select * from public.claim_series_to_materialize(10)"))).rejects.toMatchObject({ code: "42501" });

    await insertReservation(db, {
      roomId: workerRoom,
      startAt: dates[1].startAt,
      endAt: dates[1].endAt,
      status: "approved",
    });
    const claims = await asRole(db, "service_role", async (tx) =>
      (await tx.query<{ id: string; claim_id: string }>("select id, claim_id from public.claim_series_to_materialize(100)")).rows,
    );
    const claim = claims.find((item) => item.id === created.series_id)!;
    expect(claim.claim_id).toBeTruthy();
    const competingClaims = await asRole(db, "service_role", async (tx) =>
      (await tx.query<{ id: string }>("select id from public.claim_series_to_materialize(100)")).rows,
    );
    expect(competingClaims.some((item) => item.id === created.series_id)).toBe(false);

    const [result] = await asRole(db, "service_role", async (tx) =>
      (
        await tx.query<{ created_count: number; exception_count: number; series_status: string }>(
          "select * from public.materialize_series_occurrences($1, $2, $3::jsonb, $4::date)",
          [created.series_id, claim.claim_id, JSON.stringify(occurrences(dates.slice(1, 3))), dates[2].date],
        )
      ).rows,
    );
    expect(Number(result.created_count)).toBe(1);
    expect(Number(result.exception_count)).toBe(1);
    expect(result.series_status).toBe("active");

    const seriesReservations = await db.query<{ occurrence_date: string }>(
      "select occurrence_date::text from public.reservations where series_id = $1 order by occurrence_date",
      [created.series_id],
    );
    expect(seriesReservations.rows.map((row) => row.occurrence_date)).toEqual([dates[0].date, dates[2].date]);
    const exceptions = await db.query<{ occurrence_date: string; reason: string }>(
      "select occurrence_date::text, reason from public.reservation_series_exceptions where series_id = $1",
      [created.series_id],
    );
    expect(exceptions.rows).toEqual([{ occurrence_date: dates[1].date, reason: "conflict" }]);

    const nextClaims = await asRole(db, "service_role", async (tx) =>
      (await tx.query<{ id: string; claim_id: string }>("select id, claim_id from public.claim_series_to_materialize(100)")).rows,
    );
    const nextClaim = nextClaims.find((item) => item.id === created.series_id)!;
    const [idempotent] = await asRole(db, "service_role", async (tx) =>
      (
        await tx.query<{ created_count: number }>(
          "select * from public.materialize_series_occurrences($1, $2, $3::jsonb, $4::date)",
          [created.series_id, nextClaim.claim_id, JSON.stringify(occurrences(dates.slice(2, 4))), dates[3].date],
        )
      ).rows,
    );
    expect(Number(idempotent.created_count)).toBe(1);
    const uniqueDates = await db.query<{ occurrence_date: string }>(
      "select occurrence_date::text from public.reservations where series_id = $1 order by occurrence_date",
      [created.series_id],
    );
    expect(uniqueDates.rows.map((row) => row.occurrence_date)).toEqual([dates[0].date, dates[2].date, dates[3].date]);
  });

  it("pauses a series and records an actionable exception when its room becomes unavailable", async () => {
    const created = await createSeries(pauseRoom, dates.slice(0, 1));
    const claims = await asRole(db, "service_role", async (tx) =>
      (await tx.query<{ id: string; claim_id: string }>("select id, claim_id from public.claim_series_to_materialize(100)")).rows,
    );
    const claim = claims.find((item) => item.id === created.series_id)!;
    await db.query("update public.rooms set reservable = false where id = $1", [pauseRoom]);

    const [result] = await asRole(db, "service_role", async (tx) =>
      (
        await tx.query<{ series_status: string }>(
          "select * from public.materialize_series_occurrences($1, $2, $3::jsonb, $4::date)",
          [created.series_id, claim.claim_id, JSON.stringify(occurrences(dates.slice(1, 2))), dates[1].date],
        )
      ).rows,
    );
    expect(result.series_status).toBe("paused");
    const series = await db.query<{ status: string; paused_reason: string }>(
      "select status, paused_reason from public.reservation_series where id = $1",
      [created.series_id],
    );
    expect(series.rows[0]).toMatchObject({ status: "paused", paused_reason: "The room is currently unavailable." });
    const exception = await db.query<{ reason: string }>(
      "select reason from public.reservation_series_exceptions where series_id = $1",
      [created.series_id],
    );
    expect(exception.rows).toEqual([{ reason: "room_unavailable" }]);
  });
});
