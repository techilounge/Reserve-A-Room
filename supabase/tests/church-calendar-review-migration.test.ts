import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

import { createTestDb } from "./support/db";

it("backfills existing specific-date snapshots without changing their original facts", async () => {
  const db = await createTestDb("20261030100000_calendar_planning_portal.sql");
  try {
    const { rows: [ministry] } = await db.query<{ id: string }>("select id from public.ministries limit 1");
    const { rows: [cycle] } = await db.query<{ id: string }>("insert into public.calendar_cycles(name, start_date, end_date, submission_opens_at, submission_deadline) values ('Old cycle', current_date, current_date + 10, now(), now() + interval '1 day') returning id");
    const { rows: [plan] } = await db.query<{ id: string }>("insert into public.ministry_calendar_plans(cycle_id, ministry_id) values ($1, $2) returning id", [cycle.id, ministry.id]);
    const { rows: [grant] } = await db.query<{ id: string }>("insert into public.calendar_plan_access(plan_id, contact_name, contact_email, label, token_hash, token_seed, expires_at) values ($1, 'Planner', 'old@example.org', 'primary', decode($2, 'hex'), decode($3, 'hex'), now() + interval '1 day') returning id", [plan.id, "01".repeat(32), "02".repeat(16)]);
    const { rows: [event] } = await db.query<{ id: string }>("insert into public.calendar_events(plan_id, title, scope, visibility, location_type, estimated_attendance) values ($1, 'Old event', 'ministry', 'internal', 'church', 1) returning id", [plan.id]);
    await db.query("insert into public.calendar_event_schedules(event_id, kind, timezone, start_date, end_date, start_time, end_time) values ($1, 'specific_dates', 'America/Chicago', current_date, current_date + 2, '09:00', '10:00')", [event.id]);
    const { rows: [date] } = await db.query<{ id: string }>("insert into public.calendar_schedule_dates(event_id, local_date) values ($1, current_date + 1) returning id", [event.id]);
    const { rows: [submission] } = await db.query<{ id: string }>(`insert into public.calendar_event_submissions(event_id, plan_revision, submitted_by_grant, title, category, scope, protection, visibility, location_type, estimated_attendance, food_drinks_planned, setup_minutes, cleanup_minutes, schedule_kind, timezone, start_date, end_date, start_time, end_time)
      values ($1, 1, $2, 'Old event', 'other', 'ministry', 'normal', 'internal', 'church', 1, false, 0, 0, 'specific_dates', 'America/Chicago', current_date, current_date + 2, '09:00', '10:00') returning id`, [event.id, grant.id]);
    await db.query("insert into public.calendar_submission_dates(submission_id, local_date) values ($1, current_date + 1)", [submission.id]);
    // A previous version could already have deleted its original draft row.
    await db.query("insert into public.calendar_submission_dates(submission_id, local_date) values ($1, current_date + 2)", [submission.id]);
    await db.exec(readFileSync(fileURLToPath(new URL("../migrations/20261031100000_calendar_phase2_review_fixes.sql", import.meta.url)), "utf8"));
    const { rows: [snapshot] } = await db.query<{ logical_date_id: string; local_start_time: string; all_day: boolean }>(
      "select d.logical_date_id, d.local_start_time::text, s.all_day from public.calendar_submission_dates d join public.calendar_event_submissions s on s.id = d.submission_id where s.id = $1 order by d.local_date", [submission.id],
    );
    expect(snapshot).toEqual({ logical_date_id: date.id, local_start_time: "09:00:00", all_day: false });
    const { rows: historical } = await db.query<{ logical_date_id: string }>("select logical_date_id from public.calendar_submission_dates where submission_id = $1 order by local_date", [submission.id]);
    expect(historical).toHaveLength(2);
    expect(historical[1].logical_date_id).not.toBe(date.id);
    await expect(db.query("delete from public.calendar_submission_dates where submission_id = $1", [submission.id])).rejects.toMatchObject({ code: "RAR09" });
  } finally {
    await db.close();
  }
});
