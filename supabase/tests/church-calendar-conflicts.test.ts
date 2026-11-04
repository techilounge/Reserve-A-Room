import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createRoom, createStaff, createTestDb, insertReservation } from "./support/db";

let db: PGlite;
let superAdmin: string, admin: string, room: string, resource: string, cycle: string, date: string;
const plans: string[] = [], refs: string[] = [], events: string[] = [];
const sessions = ["a1".repeat(32), "a2".repeat(32), "a3".repeat(32)];
type Conflict = { fingerprint: string; classification: string; conflict_type: string; event_id: string; other_event_id: string | null;
  details: { participants?: { event_id: string }[] }; decision_type: string | null; selected_event_id: string | null };
const conflicts = () => asRole(db, "authenticated", tx => tx.query<Conflict>("select * from public.calendar_list_conflicts()"), admin);

beforeAll(async () => {
  db = await createTestDb();
  superAdmin = await createStaff(db, "super_admin"); admin = await createStaff(db, "admin");
  date = (await db.query<{ d: string }>("select ((now() at time zone 'America/Chicago')::date + 14)::text as d")).rows[0].d;
  room = await createRoom(db, { capacity: 50, food_drinks_allowed: false });
  resource = (await db.query<{ id: string }>("insert into public.calendar_resources(name,category,available_quantity) values ('One projector','equipment',1) returning id")).rows[0].id;
  cycle = (await asRole(db, "authenticated", tx => tx.query<{ id: string }>(
    "select public.save_calendar_cycle(null,'Conflict test',current_date,current_date+60,now()-interval '1 day',now()+interval '30 days','') as id"), superAdmin)).rows[0].id;
  const ministries = await db.query<{ id: string }>("select id from public.ministries where active order by name limit 3");
  while (ministries.rows.length < 3) ministries.rows.push((await db.query<{ id: string }>("insert into public.ministries(name) values ($1) returning id", [`Conflict ministry ${ministries.rows.length}`])).rows[0]);
  for (const ministry of ministries.rows) {
    const plan = (await asRole(db, "authenticated", tx => tx.query<{ id: string }>("select public.add_calendar_ministry($1,$2) as id", [cycle, ministry.id]), superAdmin)).rows[0].id;
    plans.push(plan);
    refs.push((await db.query<{ reference_code: string }>("select reference_code from public.ministry_calendar_plans where id=$1", [plan])).rows[0].reference_code);
  }
  await asRole(db, "authenticated", tx => tx.query("select public.transition_calendar_cycle($1,'open',null)", [cycle]), superAdmin);
  await db.query("update private.calendar_planner_policies set enabled=true,privacy_version='p1',terms_version='t1'");
  for (let i = 0; i < 3; i++) {
    const grant = crypto.randomUUID(), token = String(i + 1).repeat(64);
    await asRole(db, "authenticated", tx => tx.query("select public.invite_calendar_planner($1,$2,$3,$4,null,'additional',$5,$6)",
      [plans[i], grant, `Planner ${i}`, `conflict-${i}@example.org`, token, String(i + 1).repeat(32)]), superAdmin);
    await asRole(db, "service_role", tx => tx.query("select public.exchange_calendar_planner_session($1,$2,$3,$4)", [refs[i], grant, token, sessions[i]]));
    await asRole(db, "service_role", tx => tx.query("select public.calendar_accept_planner_policies($1,$2,'p1','t1')", [refs[i], sessions[i]]));
  }
  const save = async (i: number, data: unknown) => (await asRole(db, "service_role", tx => tx.query<{ id: string }>(
    "select public.calendar_save_event_draft($1,$2,null,$3::jsonb) as id", [refs[i], sessions[i], JSON.stringify(data)]))).rows[0].id;
  const common = { scope: "church_wide", visibility: "internal", location_type: "church", estimated_attendance: 10,
    setup_minutes: 30, cleanup_minutes: 15, rooms: [room], resources: [{ id: resource, quantity: 1 }],
    schedule: { kind: "one_time", timezone: "America/Chicago", all_day: false, start_date: date, end_date: date, start_time: "09:00", end_time: "10:00" } };
  events.push(await save(0, { ...common, title: "Choir private title", protection: "exclusive", estimated_attendance: 70, food_drinks_planned: true }));
  events.push(await save(1, { ...common, title: "Youth private title", protection: "normal",
    schedule: { ...common.schedule, start_time: "10:30", end_time: "11:30" } }));
  events.push(await save(1, { ...common, title: "Online private title", protection: "exclusive", location_type: "virtual", rooms: [], resources: [] }));
  events.push(await save(2, { ...common, title: "Unsubmitted private title", protection: "normal" }));
  for (let i = 0; i < 2; i++) await asRole(db, "service_role", tx => tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[i], sessions[i]]));
});

it("preserves pre-remediation decisions as untrusted legacy history during upgrade", async () => {
  const oldDb = await createTestDb("20261106100000_church_calendar_conflicts.sql");
  try {
    const actor = await createStaff(oldDb, "super_admin");
    const cycleId = (await oldDb.query<{ id: string }>(`insert into public.calendar_cycles(name,start_date,end_date,submission_opens_at,submission_deadline)
      values ('Upgrade',current_date,current_date+30,now()-interval '1 day',now()+interval '1 day') returning id`)).rows[0].id;
    const planId = (await oldDb.query<{ id: string }>("insert into public.ministry_calendar_plans(cycle_id,ministry_id) select $1,id from public.ministries limit 1 returning id", [cycleId])).rows[0].id;
    const eventId = (await oldDb.query<{ id: string }>(`insert into public.calendar_events(plan_id,title,scope,visibility,location_type,estimated_attendance)
      values ($1,'Legacy','ministry','internal','church',1) returning id`, [planId])).rows[0].id;
    await oldDb.query("insert into public.calendar_conflict_decisions(fingerprint,conflict_type,selected_event_id,reason,decided_by) values ($1,'same_ministry',$2,'Old decision',$3)", ["a".repeat(32),eventId,actor]);
    await oldDb.exec(readFileSync("supabase/migrations/20261107100000_calendar_conflict_decision_context.sql", "utf8"));
    const legacy = (await oldDb.query<{ decision_type: string; context: { legacy: boolean; context_unavailable: boolean } }>("select decision_type,context from public.calendar_conflict_decisions")).rows[0];
    expect(legacy).toEqual({ decision_type: "legacy", context: expect.objectContaining({ legacy: true, context_unavailable: true }) });
  } finally { await oldDb.close(); }
});
afterAll(async () => { await db.close(); });

describe("Church Calendar conflicts", () => {
  it("compares submitted snapshots, keeps hard blocks separate, and applies on-site exclusivity", async () => {
    const rows = (await conflicts()).rows;
    const kinds = rows.map(row => row.conflict_type);
    expect(kinds).toEqual(expect.arrayContaining(["room_planning", "exclusive_planning", "church_wide_overlap", "same_ministry", "room_capacity", "food_policy", "resource_planning"]));
    expect(kinds).not.toContain("large_event"); // 70 attendees are below the configurable 100 default.
    expect(rows.filter(row => row.conflict_type === "room_capacity").every(row => row.classification === "warning")).toBe(true);
    expect(rows.filter(row => row.conflict_type === "food_policy").every(row => row.classification === "hard")).toBe(true);
    expect(rows.filter(row => row.conflict_type === "exclusive_planning").every(row => ![row.event_id,row.other_event_id].includes(events[2]))).toBe(true);
    const ranges = await db.query<{ event_overlap: boolean; occupancy_overlap: boolean }>(`select a.event_range && b.event_range as event_overlap,
      a.occupancy_range && b.occupancy_range as occupancy_overlap from public.calendar_submission_occurrences a
      join public.calendar_event_submissions sa on sa.id=a.submission_id
      cross join public.calendar_submission_occurrences b join public.calendar_event_submissions sb on sb.id=b.submission_id
      where sa.event_id=$1 and sb.event_id=$2`, [events[0],events[1]]);
    expect(ranges.rows[0]).toEqual({ event_overlap: false, occupancy_overlap: true });
    expect(rows.every(row => ![row.event_id,row.other_event_id].includes(events[3]))).toBe(true);
    const resourceRows = rows.filter(row => row.conflict_type === "resource_planning");
    expect(resourceRows).toHaveLength(1);
    expect(resourceRows[0].details.participants?.map(p => p.event_id)).toEqual(expect.arrayContaining([events[0],events[1]]));
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.reservations")).rows[0].n).toBe(0);
  });

  it("requires staff, hides other ministries from planners, and blocks hard overrides", async () => {
    await expect(asRole(db, "anon", tx => tx.query("select * from public.calendar_list_conflicts()"))).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_conflict_policy_save(60)"), admin)).rejects.toMatchObject({ code: "RAR09" });
    const planner = await asRole(db, "service_role", tx => tx.query("select * from public.calendar_planner_conflicts($1,$2)", [refs[0], sessions[0]]));
    expect(planner.rows.length).toBeGreaterThan(0);
    expect(JSON.stringify(planner.rows)).not.toContain("Youth private title");
    expect(JSON.stringify(planner.rows)).not.toContain(events[1]);
    const hard = (await conflicts()).rows.find(row => row.conflict_type === "food_policy")!;
    for (const type of ["advance", "acknowledge"]) {
      await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,$2,'No override',$3)", [hard.fingerprint, type, type === "advance" ? hard.event_id : null]), admin)).rejects.toMatchObject({ code: "RAR09" });
    }
  });

  it("acknowledges a whole warning without choosing a winner and preserves immutable context", async () => {
    const warning = (await conflicts()).rows.find(row => row.conflict_type === "church_wide_overlap" && row.other_event_id)!;
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'acknowledge','Reason',$2)", [warning.fingerprint, warning.event_id]), admin)).rejects.toMatchObject({ code: "RAR09" });
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance','Reason',$2)", [warning.fingerprint, warning.event_id]), admin)).rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'acknowledge','Both may proceed')", [warning.fingerprint]), admin);
    const current = (await conflicts()).rows.find(row => row.fingerprint === warning.fingerprint)!;
    expect(current.decision_type).toBe("acknowledge");
    expect(current.selected_event_id).toBeNull();
    const saved = (await db.query<{ id: string; context: { participants: { event_id: string; submission_id: string; submitted_revision: number; snapshot_id: string }[]; policy_revision: number } }>(
      "select id,context from public.calendar_conflict_decisions where fingerprint=$1", [warning.fingerprint])).rows[0];
    expect(saved.context.participants.map(p => p.event_id)).toEqual(expect.arrayContaining([warning.event_id,warning.other_event_id]));
    expect(saved.context.participants.every(p => p.submission_id && p.snapshot_id && p.submitted_revision > 0)).toBe(true);
    expect(saved.context.policy_revision).toBe(1);
    const audit = await db.query<{ metadata: { context: unknown } }>("select metadata from public.audit_logs where entity_type='calendar_conflict_decision' and entity_id=$1", [saved.id]);
    expect(audit.rows[0].metadata.context).toEqual(saved.context);
    await expect(db.query("update public.calendar_conflict_decisions set reason='rewritten' where id=$1", [saved.id])).rejects.toMatchObject({ code: "RAR09" });
    await expect(db.query("delete from public.calendar_conflict_decisions where id=$1", [saved.id])).rejects.toMatchObject({ code: "RAR09" });
  });

  it("invalidates decisions when room or resource configuration changes without deleting history", async () => {
    const initial = (await conflicts()).rows;
    const roomConflict = initial.find(row => row.conflict_type === "room_planning")!;
    const resourceConflict = initial.find(row => row.conflict_type === "resource_planning")!;
    for (const conflict of [roomConflict,resourceConflict]) {
      await asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance','Current priority',$2)", [conflict.fingerprint, events[0]]), admin);
    }
    await db.query("update public.rooms set name=name || ' updated',updated_at=clock_timestamp() where id=$1", [room]);
    await asRole(db, "authenticated", tx => tx.query("select public.save_calendar_resource($1,'One projector updated','equipment',2,true,null,null)", [resource]), superAdmin);
    const current = (await conflicts()).rows;
    expect(current.some(row => row.fingerprint === roomConflict.fingerprint || row.fingerprint === resourceConflict.fingerprint)).toBe(false);
    const history = await db.query<{ fingerprint: string }>("select fingerprint from public.calendar_conflict_decisions where fingerprint in ($1,$2)", [roomConflict.fingerprint,resourceConflict.fingerprint]);
    expect(history.rows).toHaveLength(2);
    await asRole(db, "authenticated", tx => tx.query("select public.save_calendar_resource($1,'One projector','equipment',1,true,null,null)", [resource]), superAdmin);
  });

  it("distinguishes confirmed resource shortages from provisional conflicts without double-counting the owner", async () => {
    const snapshot = (await db.query<{ id: string }>(`select o.id from public.calendar_submission_occurrences o
      join public.calendar_event_submissions s on s.id=o.submission_id where s.event_id=$1 limit 1`, [events[0]])).rows[0].id;
    await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: admin, role: "authenticated" })]);
    const allocation = (await db.query<{ id: string }>("select private.calendar_allocate_resource($1,$2) as id", [snapshot, resource])).rows[0].id;
    const rows = (await conflicts()).rows.filter(row => row.conflict_type === "resource_capacity");
    expect(rows.some(row => row.event_id === events[1] && row.classification === "hard")).toBe(true);
    expect(rows.some(row => row.event_id === events[0])).toBe(false);
    expect((await conflicts()).rows.some(row => row.conflict_type === "resource_planning" && row.event_id === events[0])).toBe(false);
    const ownerConflicts = await asRole(db, "service_role", tx => tx.query<{ conflict_type: string }>("select * from public.calendar_planner_conflicts($1,$2)", [refs[0], sessions[0]]));
    const competingConflicts = await asRole(db, "service_role", tx => tx.query<{ conflict_type: string }>("select * from public.calendar_planner_conflicts($1,$2)", [refs[1], sessions[1]]));
    expect(ownerConflicts.rows.some(row => row.conflict_type === "resource_capacity")).toBe(false);
    expect(competingConflicts.rows.some(row => row.conflict_type === "resource_capacity")).toBe(true);
    await db.query("select private.calendar_release_resource($1)", [allocation]);
    expect((await conflicts()).rows.some(row => row.conflict_type === "resource_planning")).toBe(true);
  });

  it("records one revision-bound resource priority and invalidates decisions after policy or submission changes", async () => {
    const initial = (await conflicts()).rows;
    const resourceConflict = initial.find(row => row.conflict_type === "resource_planning")!;
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance','Missing winner')", [resourceConflict.fingerprint]), admin)).rejects.toMatchObject({ code: "RAR09" });
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance','Wrong winner',$2)", [resourceConflict.fingerprint, events[3]]), admin)).rejects.toMatchObject({ code: "RAR09" });
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'acknowledge','Wrong decision')", [resourceConflict.fingerprint]), admin)).rejects.toMatchObject({ code: "RAR09" });
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance',$2,$3)", [resourceConflict.fingerprint, "Youth first", events[1]]), admin);
    expect((await conflicts()).rows.find(row => row.fingerprint === resourceConflict.fingerprint)?.selected_event_id).toBe(events[1]);
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance',$2,$3)", [resourceConflict.fingerprint, "Choir first", events[0]]), admin);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_conflict_decisions where fingerprint=$1", [resourceConflict.fingerprint])).rows[0].n).toBe(2);
    const roomConflict = initial.find(row => row.conflict_type === "room_planning")!;
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance',$2,$3)", [roomConflict.fingerprint, "Choir has priority", events[0]]), admin);
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_request_plan_changes($1,'Please revise')", [plans[1]]), admin);
    expect((await conflicts()).rows.find(row => row.fingerprint === roomConflict.fingerprint)?.selected_event_id).toBe(events[0]);
    const portal = (await asRole(db, "service_role", tx => tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[1], sessions[1]]))).rows[0].value;
    const event = portal.events.find(row => row.id === events[1])!;
    const schedule = event.schedule as Record<string, unknown>;
    await asRole(db, "service_role", tx => tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[1], sessions[1], events[1], JSON.stringify({ ...event, schedule: { ...schedule, end_time: "12:00" } })]));
    expect((await conflicts()).rows.find(row => row.fingerprint === roomConflict.fingerprint)?.selected_event_id).toBe(events[0]);
    await asRole(db, "service_role", tx => tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[1], sessions[1]]));
    expect((await conflicts()).rows.some(row => row.fingerprint === roomConflict.fingerprint)).toBe(false);
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance',$2,$3)", [roomConflict.fingerprint, "Stale selection", events[0]]), admin)).rejects.toMatchObject({ code: "RAR09" });
    const history = (await db.query<{ context: { participants: { event_id: string; submission_id: string; submitted_revision: number; snapshot_id: string }[]; related_entity_id: string } }>("select context from public.calendar_conflict_decisions where fingerprint=$1", [roomConflict.fingerprint])).rows[0].context;
    expect(history.related_entity_id).toBe(room);
    expect(history.participants.map(p => p.event_id)).toEqual(expect.arrayContaining([events[0],events[1]]));
    expect(history.participants.every(p => p.submission_id && p.snapshot_id && p.submitted_revision > 0)).toBe(true);
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_conflict_policy_save(60)"), superAdmin);
    expect((await conflicts()).rows.some(row => row.conflict_type === "large_event")).toBe(true);
    expect((await conflicts()).rows.some(row => row.fingerprint === resourceConflict.fingerprint)).toBe(false);
    const warningHistory = (await db.query<{ fingerprint: string; context: { participants: unknown[]; policy_revision: number } }>(
      "select fingerprint,context from public.calendar_conflict_decisions where decision_type='acknowledge' limit 1")).rows[0];
    expect((await conflicts()).rows.some(row => row.fingerprint === warningHistory.fingerprint)).toBe(false);
    expect(warningHistory.context.participants).toHaveLength(2);
    expect(warningHistory.context.policy_revision).toBe(1);
  });

  it("retains every participant and submitted revision for a three-event resource conflict", async () => {
    await asRole(db, "service_role", tx => tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2], sessions[2]]));
    const resourceConflict = (await conflicts()).rows.find(row => row.conflict_type === "resource_planning" &&
      row.details.participants?.length === 3)!;
    expect(resourceConflict).toBeDefined();
    await asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance','Priority after review',$2)",
      [resourceConflict.fingerprint,events[3]]), admin);
    const row = (await db.query<{ context: { related_entity_type: string; related_entity_id: string; participants: { event_id: string; submission_id: string; submitted_revision: number; snapshot_id: string; occurrence_id: string }[] } }>(
      "select context from public.calendar_conflict_decisions where fingerprint=$1 order by decision_order desc limit 1", [resourceConflict.fingerprint])).rows[0];
    expect(row.context.related_entity_type).toBe("resource");
    expect(row.context.related_entity_id).toBe(resource);
    expect(row.context.participants.map(p => p.event_id)).toEqual(expect.arrayContaining([events[0],events[1],events[3]]));
    expect(row.context.participants.every(p => p.submission_id && p.snapshot_id && p.occurrence_id && p.submitted_revision > 0)).toBe(true);
  });

  it("treats an existing room reservation as a hard block and never allows a decision to override it", async () => {
    const times = (await db.query<{ starts: string; ends: string }>("select ($1::date + time '09:00') at time zone 'America/Chicago' as starts, ($1::date + time '09:30') at time zone 'America/Chicago' as ends", [date])).rows[0];
    await insertReservation(db, { roomId: room, startAt: times.starts, endAt: times.ends });
    const block = (await conflicts()).rows.find(row => row.conflict_type === "room_reservation")!;
    expect(block.classification).toBe("hard");
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_record_conflict_decision($1,'advance',$2,$3)", [block.fingerprint, "Override attempt", block.event_id]), admin)).rejects.toMatchObject({ code: "RAR09" });
  });

  it("excludes removed and restored stale proposals while retaining historical decisions", async () => {
    const plan = (await db.query<{ ministry_id: string }>("select ministry_id from public.ministry_calendar_plans where id=$1", [plans[1]])).rows[0];
    const decisionsBefore = (await db.query<{ n: number }>("select count(*)::int as n from public.calendar_conflict_decisions")).rows[0].n;
    await asRole(db, "authenticated", tx => tx.query("select public.remove_calendar_ministry($1)", [plans[1]]), superAdmin);
    expect((await conflicts()).rows.every(row => ![row.event_id,row.other_event_id].includes(events[1]))).toBe(true);
    await asRole(db, "authenticated", tx => tx.query("select public.add_calendar_ministry($1,$2)", [cycle, plan.ministry_id]), superAdmin);
    expect((await conflicts()).rows.every(row => ![row.event_id,row.other_event_id].includes(events[1]))).toBe(true);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_conflict_decisions")).rows[0].n).toBe(decisionsBefore);
  });
});
