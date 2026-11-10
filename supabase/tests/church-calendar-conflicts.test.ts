import type { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asRole, createRoom, createStaff, createTestDb, insertReservation, type Queryable } from "./support/db";
import { createPublicIcal } from "../../src/lib/public-calendar/ical";
import { publicCalendarSyncPayload } from "../../src/lib/public-calendar/types";

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
  it("exposes only approved public immutable occurrences and removes cancelled dates", async () => {
    const rollback=new Error("rollback public calendar fixture");
    await expect(db.transaction(async tx => {
      const next=(await tx.query<{d:string}>("select ($1::date+1)::text d",[date])).rows[0].d;
      const next2=(await tx.query<{d:string}>("select ($1::date+2)::text d",[date])).rows[0].d;
      const flush=async () => {
        await tx.exec("set constraints calendar_publication_commitment, calendar_publication_cancellation immediate");
        await tx.exec("set constraints calendar_publication_commitment, calendar_publication_cancellation deferred");
      };
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"service_role"})]);
      const portal=(await tx.query<{v:{events:Record<string,unknown>[]}}>("select public.calendar_planner_portal($1,$2) v",[refs[2],sessions[2]])).rows[0].v;
      const draft=portal.events.find(item => item.id===events[3])!;
      const common={...draft,scope:"ministry",protection:"normal",location_type:"virtual",rooms:[],resources:[],ministries:[],
        food_drinks_planned:false,description:"PRIVATE INTERNAL DESCRIPTION",requester_notes:"PRIVATE REQUESTER NOTES",
        virtual_url:"https://private.example/meeting",public_contact_email:"private@example.org",public_description:"Public description"};
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[refs[2],sessions[2],events[3],JSON.stringify({...common,title:"Public event",visibility:"public",
        schedule:{kind:"specific_dates",timezone:"America/Chicago",start_date:date,end_date:next2},
        dates:[{start_date:date,end_date:date,start_time:"15:00",end_time:"16:00"},{start_date:next,end_date:next,start_time:"15:00",end_time:"16:00"},{start_date:next2,end_date:next2,start_time:"15:00",end_time:"16:00"}]})]);
      const internal=(await tx.query<{id:string}>("select public.calendar_save_event_draft($1,$2,null,$3::jsonb) id",[refs[2],sessions[2],JSON.stringify({...common,title:"PRIVATE INTERNAL EVENT",visibility:"internal",draft_version:null,
        schedule:{kind:"one_time",timezone:"America/Chicago",start_date:date,end_date:date,start_time:"17:00",end_time:"18:00"},dates:[]})])).rows[0].id;
      const read=async (limit=10,offset=0) => {
        await tx.exec("set local role anon");
        const result=(await tx.query<{v:{events:{uid:string;title:string;description:string;sequence:number;starts_at:string}[];has_more:boolean}}>("select public.calendar_public_occurrences($1,$2,$3,$4) v",[date,next2,limit,offset])).rows[0].v;
        await tx.exec("reset role");
        return result;
      };
      const sync=async () => {
        await tx.exec("set local role anon");
        const result=(await tx.query<{v:{events:({uid:string;status:string;sequence:number;last_modified:string} & Record<string,unknown>)[]}}>("select public.calendar_public_sync_feed($1,$2,200,0) v",[date,next2])).rows[0].v.events;
        await tx.exec("reset role");
        return result;
      };
      expect((await read()).events).toHaveLength(0); // live drafts
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)",[refs[2],sessions[2]]);
      expect((await read()).events).toHaveLength(0); // submitted proposals
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"authenticated",sub:admin})]);
      let commitment=(await tx.query<{id:string}>("select public.calendar_approve_event($1,1,'','','') id",[events[3]])).rows[0].id;
      const internalCommitment=(await tx.query<{id:string}>("select public.calendar_approve_event($1,1,'','','') id",[internal])).rows[0].id;
      await flush();
      await tx.query("select public.calendar_cancel_event($1,$2,'Internal only cancellation')",[internal,internalCommitment]);
      await flush();
      const page1=await read(1); const page2=await read(1,1); const page3=await read(1,2);
      expect(page1.has_more).toBe(true); expect(page2.has_more).toBe(true); expect(page3.has_more).toBe(false);
      expect((await sync()).every(item => item.status === "published")).toBe(true); // internal event has no tombstone
      expect(page1.events[0]).toMatchObject({title:"Public event",description:"Public description"});
      expect(page1.events[0].uid).not.toBe(page2.events[0].uid);
      expect(JSON.stringify([page1,page2])).not.toMatch(/PRIVATE|private@example|private\.example|requester_notes|occupancy|resource/i);
      const occ=(await tx.query<{id:string;logical_occurrence_id:string}>("select id,logical_occurrence_id from public.calendar_submission_occurrences where submission_id=(select submission_id from public.calendar_event_commitments where id=$1) order by start_at limit 1",[commitment])).rows[0];
      await tx.exec("set local role anon");
      const detail=(await tx.query<{v:{uid:string}}>("select public.calendar_public_occurrence($1,$2) v",[events[3],occ.logical_occurrence_id])).rows[0].v;
      await tx.exec("reset role");
      expect(detail.uid).toBe(page1.events[0].uid);
      // Submitted edits are private until the replacement approval is committed.
      await tx.query("select public.calendar_request_plan_changes($1,'Update event time')",[plans[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"service_role"})]);
      const revised=(await tx.query<{v:{events:Record<string,unknown>[]}}>("select public.calendar_planner_portal($1,$2) v",[refs[2],sessions[2]])).rows[0].v.events.find(item => item.id===events[3])!;
      const revisedDates=(revised.dates as Record<string,unknown>[]).slice(0,2).map((item,index) => index===0 ? {...item,start_time:"15:15",end_time:"16:15"} : item);
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[refs[2],sessions[2],events[3],JSON.stringify({...revised,title:"Revised public event",dates:revisedDates})]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)",[refs[2],sessions[2]]);
      expect((await read()).events[0].title).toBe("Public event");
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"authenticated",sub:admin})]);
      commitment=(await tx.query<{id:string}>("select public.calendar_approve_event($1,2,'','','',$2) id",[events[3],commitment])).rows[0].id;
      await flush();
      const replaced=await read();
      expect(replaced.events[0]).toMatchObject({uid:page1.events[0].uid,title:"Revised public event"});
      expect(replaced.events[0].sequence).toBeGreaterThan(page1.events[0].sequence);
      expect(replaced.events[0].starts_at).not.toBe(page1.events[0].starts_at);
      expect(replaced.events[1].uid).toBe(page2.events[0].uid);
      const removed=(await sync()).find(item => item.uid===page3.events[0].uid)!;
      expect(removed.status).toBe("cancelled");
      expect(removed.sequence).toBeGreaterThan(page3.events[0].sequence);
      expect(JSON.stringify(removed)).not.toMatch(/Public event|description|location|PRIVATE|private\.example/i);
      const revisedOcc=(await tx.query<{id:string}>("select id from public.calendar_submission_occurrences where submission_id=(select submission_id from public.calendar_event_commitments where id=$1) and logical_occurrence_id=$2",[commitment,occ.logical_occurrence_id])).rows[0].id;
      await tx.query("select public.calendar_cancel_event_occurrence($1,$2,$3,'Date cancelled')",[events[3],commitment,revisedOcc]);
      await flush();
      const cancelled=(await sync()).find(item => item.uid===page1.events[0].uid)!;
      expect(cancelled.status).toBe("cancelled");
      expect(cancelled.sequence).toBeGreaterThan(replaced.events[0].sequence);
      expect((await read()).events.map(e => e.uid)).toEqual([page2.events[0].uid]);
      await tx.exec("set local role anon");
      expect((await tx.query<{v:unknown}>("select public.calendar_public_occurrence($1,$2) v",[events[3],occ.logical_occurrence_id])).rows[0].v).toBeNull();
      await tx.exec("reset role");
      await tx.query("select public.calendar_request_plan_changes($1,'Make event internal')",[plans[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"service_role"})]);
      const unpublished=(await tx.query<{v:{events:Record<string,unknown>[]}}>("select public.calendar_planner_portal($1,$2) v",[refs[2],sessions[2]])).rows[0].v.events.find(item => item.id===events[3])!;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[refs[2],sessions[2],events[3],JSON.stringify({...unpublished,visibility:"internal"})]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)",[refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"authenticated",sub:admin})]);
      commitment=(await tx.query<{id:string}>("select public.calendar_approve_event($1,3,'','','',$2) id",[events[3],commitment])).rows[0].id;
      await flush();
      expect((await read()).events).toHaveLength(0);
      const privateWithdrawal=(await sync()).find(item => item.uid===page2.events[0].uid)!;
      expect(privateWithdrawal.status).toBe("cancelled");
      expect(privateWithdrawal.sequence).toBeGreaterThan(replaced.events[1].sequence);
      expect(JSON.stringify(privateWithdrawal)).not.toMatch(/Revised public event|Public description|Online|PRIVATE|private\.example/i);
      await tx.exec("set local role anon");
      expect((await tx.query<{v:unknown}>("select public.calendar_public_occurrence($1,$2) v",
        [events[3],page2.events[0].uid.slice(37,73)])).rows[0].v).toBeNull();
      await tx.exec("reset role");
      const feed=publicCalendarSyncPayload.parse({version:1,timezone:"America/Chicago",has_more:false,events:await sync()});
      const ics=createPublicIcal(feed.events,"https://example.org").replace(/\r\n /g,"");
      expect(ics).toContain(`UID:${page2.events[0].uid}`);
      expect(ics).toContain("STATUS:CANCELLED");
      expect(ics).not.toMatch(/SUMMARY:|DESCRIPTION:|LOCATION:|URL:|Revised public event|Public description|private\.example/i);
      // Republishing the same logical identity must supersede the cancellation.
      await tx.query("select public.calendar_request_plan_changes($1,'Publish again')",[plans[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"service_role"})]);
      const republish=(await tx.query<{v:{events:Record<string,unknown>[]}}>("select public.calendar_planner_portal($1,$2) v",[refs[2],sessions[2]])).rows[0].v.events.find(item => item.id===events[3])!;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[refs[2],sessions[2],events[3],JSON.stringify({...republish,visibility:"public"})]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)",[refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"authenticated",sub:admin})]);
      commitment=(await tx.query<{id:string}>("select public.calendar_approve_event($1,4,'','','',$2) id",[events[3],commitment])).rows[0].id;
      await flush();
      const again=(await sync()).find(item => item.uid===page2.events[0].uid)!;
      expect(again.status).toBe("published");
      expect(again.sequence).toBeGreaterThan(privateWithdrawal.sequence);
      expect((await read()).events[0].sequence).toBe(again.sequence);
      await tx.query("select public.calendar_cancel_event($1,$2,'Event cancelled')",[events[3],commitment]);
      await flush();
      const whole=(await sync()).find(item => item.uid===again.uid)!;
      expect(whole.status).toBe("cancelled"); expect(whole.sequence).toBeGreaterThan(again.sequence);
      // Owner-only synthetic history isolates both retention arms and exact boundaries.
      const synthetic=["a","b","c","d","e"].map(c => `${c.repeat(8)}-${c.repeat(4)}-4${c.repeat(3)}-8${c.repeat(3)}-${c.repeat(12)}`);
      for (const [index,changedDays,endDays] of [[0,89,31],[1,91,29],[2,91,31],[3,90,31],[4,91,30]]) {
        await tx.query(`insert into private.calendar_publication_history(event_id,logical_occurrence_id,sequence,status,commitment_id,
          start_at,end_at,local_start_date,local_end_date,timezone,all_day,changed_at)
          values($1,$2,1,'cancelled',$3,now()-($4::int+1)*interval '1 day',now()-$4::int*interval '1 day',
          current_date-($4::int+1),current_date-$4::int,'America/Chicago',false,now()-$5::int*interval '1 day')`,
          [synthetic[index],crypto.randomUUID(),commitment,endDays,changedDays]);
      }
      await tx.exec("set local role anon");
      const retained=(await tx.query<{v:{events:{uid:string}[]}}>(`select public.calendar_public_sync_feed(
        (now() at time zone 'America/Chicago')::date,(now() at time zone 'America/Chicago')::date,200,0) v`)).rows[0].v.events;
      await tx.exec("reset role");
      expect(retained.some(item => item.uid.startsWith(synthetic[0]))).toBe(true);
      expect(retained.some(item => item.uid.startsWith(synthetic[1]))).toBe(true);
      for (const id of synthetic.slice(2)) expect(retained.some(item => item.uid.startsWith(id))).toBe(false);
      const access=(await tx.query<{anon:boolean;staff:boolean;service:boolean}>(`select
        has_table_privilege('anon','private.calendar_publication_history','select') anon,
        has_table_privilege('authenticated','private.calendar_publication_history','select') staff,
        has_table_privilege('service_role','private.calendar_publication_history','select') service`)).rows[0];
      expect(access).toEqual({anon:false,staff:false,service:false});
      await tx.exec(`do $$ begin
        begin update private.calendar_publication_history set sequence=sequence where event_id='${synthetic[0]}';
        exception when sqlstate 'RAR09' then return; end;
        raise exception 'Publication history accepted an update';
      end $$`);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("uses identical reminder milestones when queueing and delivering, including delayed first attempts", async () => {
    const rollback=new Error("rollback delayed reminder fixture");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"service_role"})]);
      await tx.query("update public.calendar_cycles set submission_opens_at=now()-interval '60 days' where id=$1",[cycle]);
      const grant=(await tx.query<{id:string;version:number;contact_email:string}>(
        "select id,version,contact_email from public.calendar_plan_access where plan_id=$1 and revoked_at is null",[plans[2]])).rows[0];
      const scenarios = [
        { offset:13, old:"days30", current:"days14", valid:false, queue:true },
        { offset:6, old:"days14", current:"days7", valid:false, queue:true },
        { offset:-3, old:"overdue", current:"overdue", valid:true, queue:false },
        { offset:-7, old:"overdue", current:"overdue", valid:false, queue:false },
        { offset:-8, old:"overdue", current:"overdue", valid:false, queue:false },
      ] as const;
      for (const scenario of scenarios) {
        const current=(await tx.query<{deadline:Date;revision:number}>(`update public.calendar_cycles
          set submission_deadline=now()+$2::int*interval '1 day' where id=$1
          returning submission_deadline as deadline,reminder_revision as revision`,[cycle,scenario.offset])).rows[0];
        const reminder=(await tx.query<{id:string}>(`insert into public.calendar_plan_reminders
          (plan_id,grant_id,grant_version,deadline_revision,kind,deadline,created_at)
          values($1,$2,$3,$4,$5,$6,now()-interval '17 days') returning id`,
          [plans[2],grant.id,grant.version,current.revision,scenario.old,current.deadline])).rows[0].id;
        await tx.query("select private.queue_system_email($1,'calendar_plan_reminder','calendar_plan_reminder',$2)",[grant.contact_email,reminder]);
        const email=(await tx.query<{id:string;attempt_count:number}>("select id,attempt_count from public.system_email_logs where entity_id=$1",[reminder])).rows[0];
        expect(email.attempt_count).toBe(0);
        expect(Boolean((await tx.query<{v:unknown}>("select public.calendar_reminder_context($1) v",[email.id])).rows[0].v)).toBe(scenario.valid);
        if (scenario.queue) {
          // Claim exactly this old message as the worker's first attempt; the
          // database must still reject it before TypeScript considers retry age.
          await tx.query("select * from public.claim_system_emails(1,$1)",[reminder]);
          expect((await tx.query<{attempt_count:number}>("select attempt_count from public.system_email_logs where id=$1",[email.id])).rows[0].attempt_count).toBe(1);
          expect((await tx.query<{v:unknown}>("select public.calendar_reminder_context($1) v",[email.id])).rows[0].v).toBeNull();
          await tx.query("select public.complete_system_email($1,'skipped',null,null)",[email.id]);
          expect((await tx.query<{n:number}>("select public.calendar_queue_due_reminders(50) n")).rows[0].n).toBe(1);
          const deliverable=await tx.query<{kind:string}>(`select r.kind from public.system_email_logs e
            join public.calendar_plan_reminders r on r.id=e.entity_id
            where r.plan_id=$1 and r.deadline_revision=$2 and public.calendar_reminder_context(e.id) is not null`,[plans[2],current.revision]);
          expect(deliverable.rows.map(row => row.kind)).toEqual([scenario.current]);
          expect((await tx.query<{n:number}>("select public.calendar_queue_due_reminders(50) n")).rows[0].n).toBe(0);
        } else if (scenario.offset <= -7) {
          expect((await tx.query<{n:number}>("select public.calendar_queue_due_reminders(50) n")).rows[0].n).toBe(0);
        }
      }
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("classifies reminder milestone boundaries consistently", async () => {
    const rows=await db.query<{kind:string}>(`select private.calendar_reminder_milestone('2027-02-01T00:00:00Z', t::timestamptz) kind
      from unnest(array['2027-01-01T00:00:00Z','2027-01-02T00:00:00Z','2027-01-18T00:00:00Z',
        '2027-01-25T00:00:00Z','2027-02-01T00:00:00Z']) with ordinality dates(t,n) order by n`);
    expect(rows.rows.map(row => row.kind)).toEqual(["opened","days30","days14","days7","overdue"]);
  });

  it("copies only prior submitted event details and requires an explicit current date review", async () => {
    await expect(asRole(db,"authenticated",tx => tx.query("select public.calendar_copy_prior_plan($1,$2)",[plans[0],plans[2]]),admin)).rejects.toMatchObject({code:"RAR09"});
    const rollback=new Error("rollback copy fixture");
    await expect(db.transaction(async tx => {
      const targetCycle=(await tx.query<{id:string}>(`insert into public.calendar_cycles(name,start_date,end_date,submission_opens_at,submission_deadline)
        values ('Next cycle',current_date+70,current_date+120,now()-interval '1 day',now()+interval '20 days') returning id`)).rows[0].id;
      const target=(await tx.query<{id:string;reference_code:string}>(`insert into public.ministry_calendar_plans(cycle_id,ministry_id)
        select $1,ministry_id from public.ministry_calendar_plans where id=$2 returning id,reference_code`,[targetCycle,plans[0]])).rows[0];
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"authenticated",sub:superAdmin})]);
      expect((await tx.query<{n:number}>("select public.calendar_copy_prior_plan($1,$2) n",[plans[0],target.id])).rows[0].n).toBe(1);
      expect((await tx.query<{n:number}>("select public.calendar_copy_prior_plan($1,$2) n",[plans[0],target.id])).rows[0].n).toBe(0);
      const event=(await tx.query<{id:string;draft_version:number}>("select id,draft_version from public.calendar_events where plan_id=$1",[target.id])).rows[0];
      const saved=(await tx.query<{start_date:string|null}>("select start_date from public.calendar_event_schedules where event_id=$1",[event.id])).rows[0];
      expect(saved.start_date).toBeNull();
      for (const table of ["calendar_event_room_templates","calendar_event_resource_templates"]) {
        expect((await tx.query<{n:number}>(`select count(*)::int n from public.${table} where event_id=$1`,[event.id])).rows[0].n).toBe(0);
      }
      const grant=crypto.randomUUID(), token="b".repeat(64), session="b".repeat(64);
      await tx.query("select public.transition_calendar_cycle($1,'open',null)",[targetCycle]);
      await tx.query("select public.invite_calendar_planner($1,$2,'New planner','new-planner@example.org',null,'additional',$3,$4)",[target.id,grant,token,"c".repeat(32)]);
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"service_role"})]);
      await tx.query("select public.exchange_calendar_planner_session($1,$2,$3,$4)",[target.reference_code,grant,token,session]);
      await tx.query("select public.calendar_accept_planner_policies($1,$2,'p1','t1')",[target.reference_code,session]);
      const portal=(await tx.query<{v:{events:Record<string,unknown>[]}}>("select public.calendar_planner_portal($1,$2) v",[target.reference_code,session])).rows[0].v;
      const draft=portal.events[0];
      const date=(await tx.query<{d:string}>("select (current_date+75)::text d")).rows[0].d;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[target.reference_code,session,event.id,JSON.stringify({...draft,schedule:{kind:"one_time",timezone:"America/Chicago",start_date:date,end_date:date,start_time:"14:00",end_time:"15:00"}})]);
      await tx.exec("savepoint copied_submit");
      await expect(tx.query("select public.calendar_submit_plan($1,$2,'',false)",[target.reference_code,session])).rejects.toMatchObject({code:"RAR09"});
      await tx.exec("rollback to savepoint copied_submit");
      const version=(await tx.query<{draft_version:number}>("select draft_version from public.calendar_events where id=$1",[event.id])).rows[0].draft_version;
      await tx.query("select public.calendar_confirm_copied_date_review($1,$2,$3,$4)",[target.reference_code,session,event.id,version]);
      const reviewed=(await tx.query<{v:{events:Record<string,unknown>[]}}>("select public.calendar_planner_portal($1,$2) v",[target.reference_code,session])).rows[0].v.events[0];
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[target.reference_code,session,event.id,JSON.stringify(reviewed)]);
      await tx.exec("savepoint changed_after_review");
      await expect(tx.query("select public.calendar_submit_plan($1,$2,'',false)",[target.reference_code,session])).rejects.toMatchObject({code:"RAR09"});
      await tx.exec("rollback to savepoint changed_after_review");
      const changedVersion=(await tx.query<{draft_version:number}>("select draft_version from public.calendar_events where id=$1",[event.id])).rows[0].draft_version;
      await tx.query("select public.calendar_confirm_copied_date_review($1,$2,$3,$4)",[target.reference_code,session,event.id,changedVersion]);
      const duplicate=(await tx.query<{id:string}>("select public.calendar_duplicate_event_draft($1,$2,$3) id",[target.reference_code,session,event.id])).rows[0].id;
      expect((await tx.query<{v:boolean}>("select copied_date_review_required v from public.calendar_events where id=$1",[duplicate])).rows[0].v).toBe(true);
      await tx.exec("savepoint duplicated_copy");
      await expect(tx.query("select public.calendar_submit_plan($1,$2,'',false)",[target.reference_code,session])).rejects.toMatchObject({code:"RAR09"});
      await tx.exec("rollback to savepoint duplicated_copy");
      const duplicateVersion=(await tx.query<{draft_version:number}>("select draft_version from public.calendar_events where id=$1",[duplicate])).rows[0].draft_version;
      await tx.query("select public.calendar_remove_event_draft($1,$2,$3,$4)",[target.reference_code,session,duplicate,duplicateVersion]);
      expect((await tx.query<{revision:number}>("select public.calendar_submit_plan($1,$2,'',false) revision",[target.reference_code,session])).rows[0].revision).toBe(1);
      expect((await tx.query<{n:number}>("select count(*)::int n from public.calendar_event_commitments where event_id=$1",[event.id])).rows[0].n).toBe(0);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("queues reminders idempotently and invalidates stale deliveries after a deadline change", async () => {
    await expect(asRole(db,"anon",tx => tx.query("select public.calendar_queue_due_reminders(50)"))).rejects.toMatchObject({code:"42501"});
    await expect(asRole(db,"authenticated",tx => tx.query("select public.calendar_queue_due_reminders(50)"),admin)).rejects.toMatchObject({code:"42501"});
    const rollback=new Error("rollback reminder fixture");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({role:"service_role"})]);
      const first=(await tx.query<{n:number}>("select public.calendar_queue_due_reminders(50) n")).rows[0].n;
      expect(first).toBe(1);
      expect((await tx.query<{n:number}>("select public.calendar_queue_due_reminders(50) n")).rows[0].n).toBe(0);
      const email=(await tx.query<{id:string}>("select id from public.system_email_logs where event_type='calendar_plan_reminder'")).rows[0].id;
      expect((await tx.query<{v:unknown}>("select public.calendar_reminder_context($1) v",[email])).rows[0].v).toBeTruthy();
      await tx.query("update public.calendar_cycles set submission_deadline=submission_deadline+interval '1 day' where id=$1",[cycle]);
      expect((await tx.query<{v:unknown}>("select public.calendar_reminder_context($1) v",[email])).rows[0].v).toBeNull();
      expect((await tx.query<{n:number}>("select public.calendar_queue_due_reminders(50) n")).rows[0].n).toBe(1);
      expect((await tx.query<{n:number}>("select count(*)::int n from public.calendar_plan_reminders where plan_id=$1",[plans[2]])).rows[0].n).toBe(2);
      const fresh=(await tx.query<{id:string}>("select e.id from public.system_email_logs e join public.calendar_plan_reminders r on r.id=e.entity_id where r.plan_id=$1 order by r.deadline_revision desc limit 1",[plans[2]])).rows[0].id;
      await tx.query("update public.ministry_calendar_plans set submission_status='submitted' where id=$1",[plans[2]]);
      expect((await tx.query<{v:unknown}>("select public.calendar_reminder_context($1) v",[fresh])).rows[0].v).toBeNull();
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("reports staff-only cycle and ministry progress without exposing planner data", async () => {
    await expect(asRole(db,"anon",tx => tx.query("select public.calendar_planning_dashboard()"))).rejects.toMatchObject({code:"42501"});
    await expect(asRole(db,"service_role",tx => tx.query("select public.calendar_planning_dashboard()"))).rejects.toMatchObject({code:"42501"});
    const disabled=await createStaff(db,"admin",{active:false});
    await expect(asRole(db,"authenticated",tx => tx.query("select public.calendar_planning_dashboard()"),disabled)).rejects.toMatchObject({code:"RAR09"});
    const result=await asRole(db,"authenticated",tx => tx.query<{value:{id:string;submitted:number;outstanding:number;events:number;ministries:{id:string;events:number;invited:boolean}[]}[]}>("select public.calendar_planning_dashboard() as value"),admin);
    const row=result.rows[0].value.find(item => item.id===cycle)!;
    expect(row.submitted).toBe(2);
    expect(row.outstanding).toBe(1);
    expect(row.events).toBe(4);
    expect(row.ministries.find(item => item.id===plans[2])).toMatchObject({events:1,invited:true});
    expect(JSON.stringify(row)).not.toContain("conflict-0@example.org");
  });

  it("returns bounded staff calendar entries and respects room and resource filters", async () => {
    await expect(asRole(db,"anon",tx => tx.query("select * from public.calendar_master_entries($1,$1)",[date]))).rejects.toMatchObject({ code:"42501" });
    await expect(asRole(db,"service_role",tx => tx.query("select * from public.calendar_master_entries($1,$1)",[date]))).rejects.toMatchObject({ code:"42501" });
    const disabled=await createStaff(db,"admin",{ active:false });
    await expect(asRole(db,"authenticated",tx => tx.query("select * from public.calendar_master_entries($1,$1)",[date]),disabled)).rejects.toMatchObject({ code:"RAR09" });
    const all=await asRole(db,"authenticated",tx => tx.query<{ event_id:string; status:string; kind:string }>("select * from public.calendar_master_entries($1,$1)",[date]),admin);
    expect(all.rows.some(row => row.event_id===events[0] && row.status==="proposed")).toBe(true);
    expect(all.rows.some(row => row.event_id===events[3])).toBe(false);
    const rooms=await asRole(db,"authenticated",tx => tx.query<{ event_id:string }>("select * from public.calendar_master_entries($1,$1,null,null,$2)",[date,room]),admin);
    expect(rooms.rows.some(row => row.event_id===events[2])).toBe(false);
    const resources=await asRole(db,"authenticated",tx => tx.query<{ event_id:string }>("select * from public.calendar_master_entries($1,$1,null,null,null,$2)",[date,resource]),admin);
    expect(resources.rows.some(row => row.event_id===events[0])).toBe(true);
    expect(resources.rows.some(row => row.event_id===events[2])).toBe(false);
    await expect(asRole(db,"authenticated",tx => tx.query("select * from public.calendar_master_entries($1::date,$1::date+366)",[date]),admin)).rejects.toMatchObject({ code:"RAR10" });
    await expect(asRole(db,"anon",tx => tx.query("select public.calendar_master_filter_options()"))).rejects.toMatchObject({ code:"42501" });
    await expect(asRole(db,"anon",tx => tx.query("select * from public.calendar_master_conflicts($1,$1)",[date]))).rejects.toMatchObject({ code:"42501" });
    const indicators=await asRole(db,"authenticated",tx => tx.query<{ event_id:string }>("select * from public.calendar_master_conflicts($1,$1)",[date]),admin);
    expect(indicators.rows.length).toBeGreaterThan(0);
    for (const offset of [-1,1]) {
      const adjacent=await asRole(db,"authenticated",tx => tx.query<{event_id:string;other_event_id:string}>(
        "select * from public.calendar_master_conflicts($1::date+$2::int,$1::date+$2::int)",[date,offset]),admin);
      expect(adjacent.rows.some(row => [row.event_id,row.other_event_id].includes(events[0]))).toBe(true);
    }
    await expect(asRole(db,"anon",tx => tx.query("select * from public.calendar_master_entries_with_occupancy($1,$1)",[date]))).rejects.toMatchObject({ code:"42501" });
    await expect(asRole(db,"service_role",tx => tx.query("select * from public.calendar_master_entries_with_occupancy($1,$1)",[date]))).rejects.toMatchObject({ code:"42501" });
    await expect(asRole(db,"authenticated",tx => tx.query("select * from public.calendar_master_entries_with_occupancy($1,$1)",[date]),disabled)).rejects.toMatchObject({ code:"RAR09" });
    const occupancy=await asRole(db,"authenticated",tx => tx.query<{event_id:string;entry_id:string;occupancy_start:Date;occupancy_end:Date;buffers_present:boolean}>(`
      select m.event_id,m.entry_id,m.occupancy_start,m.occupancy_end,
        m.occupancy_start<m.starts_at and m.occupancy_end>m.ends_at as buffers_present
      from public.calendar_master_entries_with_occupancy($1,$1) m where m.event_id=any($2::uuid[])`,[date,events.slice(0,2)]),admin);
    expect(occupancy.rows).toHaveLength(2);
    expect(occupancy.rows.every(row => row.buffers_present)).toBe(true);
    for (const row of occupancy.rows) {
      const original=(await db.query<{occupancy_start:Date;occupancy_end:Date}>("select occupancy_start,occupancy_end from public.calendar_submission_occurrences where id=$1",[row.entry_id])).rows[0];
      expect(row.occupancy_start).toEqual(original.occupancy_start);
      expect(row.occupancy_end).toEqual(original.occupancy_end);
    }
  });

  it("shows approved occurrences once and omits their linked reservation from the room layer", async () => {
    const rollback=new Error("rollback master calendar approval");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({ role:"service_role" })]);
      const portal=(await tx.query<{ value:{ events:Record<string,unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value",[refs[2],sessions[2]])).rows[0].value;
      const event=portal.events.find(row => row.id===events[3])!;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[refs[2],sessions[2],events[3],JSON.stringify({ ...event,scope:"ministry",setup_minutes:0,cleanup_minutes:0,schedule:{ ...(event.schedule as object),start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)",[refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({ role:"authenticated",sub:admin })]);
      const commitment=(await tx.query<{ id:string }>("select public.calendar_approve_event($1,1,'Test','Planner','+15125550123') as id",[events[3]])).rows[0].id;
      const entry=(await tx.query<{ kind:string; status:string; entry_id:string }>("select * from public.calendar_master_entries($1,$1) where event_id=$2",[date,events[3]])).rows;
      expect(entry).toHaveLength(1); expect(entry[0]).toMatchObject({ kind:"event",status:"approved" });
      expect((await tx.query<{ n:number }>("select count(*)::int n from public.calendar_master_entries($1,$1,null,null,null,null,null,null,'rooms') where entry_id in (select id from public.reservations where calendar_commitment_id=$2)",[date,commitment])).rows[0].n).toBe(0);
      const occ=(await tx.query<{ id:string }>("select id from public.calendar_submission_occurrences where submission_id=(select submission_id from public.calendar_event_commitments where id=$1)",[commitment])).rows[0].id;
      await tx.query("select public.calendar_cancel_event_occurrence($1,$2,$3,'Date cancelled')",[events[3],commitment,occ]);
      expect((await tx.query<{ status:string }>("select * from public.calendar_master_entries($1,$1) where event_id=$2",[date,events[3]])).rows[0].status).toBe("cancelled");
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it.each([
    { name:"virtual", location:"virtual", resources:[] },
    { name:"offsite", location:"offsite", resources:[] },
    { name:"resource-only", location:"church", resources:[{ id:resource, quantity:1 }] },
  ])("approves a $name event without room-contact information", async ({ location, resources }) => {
    // The resource fixture is initialized in beforeAll, after the parameter list.
    const rollback = new Error("rollback roomless approval");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const portal = (await tx.query<{ value:{ events:Record<string,unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[2],sessions[2]])).rows[0].value;
      const event=portal.events.find(row => row.id===events[3])!;
      const requested = location === "church" ? [{ id:resource,quantity:1 }] : resources;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[2],sessions[2],events[3],JSON.stringify({ ...event,location_type:location,scope:"ministry",rooms:[],resources:requested,setup_minutes:0,cleanup_minutes:0,schedule:{ ...(event.schedule as object),start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      const hint = (await tx.query<{ requires_room_contact:boolean }>("select * from public.calendar_staff_room_contact_requirements() where submission_id=(select id from public.calendar_event_submissions where event_id=$1 and plan_revision=1)", [events[3]])).rows[0];
      expect(hint.requires_room_contact).toBe(false);
      const commitment=(await tx.query<{ id:string }>("select public.calendar_approve_event($1,1,null,null,null) as id", [events[3]])).rows[0].id;
      expect((await tx.query<{ n:number }>("select count(*)::int as n from public.reservations where calendar_commitment_id=$1", [commitment])).rows[0].n).toBe(0);
      const audit=(await tx.query<{ metadata:{ bypass_advance_horizon_used:boolean } }>("select metadata from public.audit_logs where action='calendar_event.approved' and entity_id=$1 order by created_at desc limit 1", [events[3]])).rows[0];
      expect(audit.metadata.bypass_advance_horizon_used).toBe(false);
      if (location === "church") expect((await tx.query<{ n:number }>("select count(*)::int as n from public.calendar_resource_allocations where status='confirmed'")).rows[0].n).toBe(1);
      if (location === "virtual") {
        await tx.query("select public.calendar_request_plan_changes($1,'Revise details')",[plans[2]]);
        await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({ role:"service_role" })]);
        const updated=(await tx.query<{ value:{ events:Record<string,unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value",[refs[2],sessions[2]])).rows[0].value.events.find(row => row.id===events[3])!;
        await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[refs[2],sessions[2],events[3],JSON.stringify({ ...updated,title:"Revised virtual event" })]);
        await tx.query("select public.calendar_submit_plan($1,$2,'',false)",[refs[2],sessions[2]]);
        await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({ role:"authenticated",sub:admin })]);
        const replacement=(await tx.query<{ id:string }>("select public.calendar_approve_event($1,2,'','','',$2) as id",[events[3],commitment])).rows[0].id;
        expect((await tx.query<{ n:number }>("select count(*)::int as n from public.reservations where calendar_commitment_id=$1",[replacement])).rows[0].n).toBe(0);
        expect((await tx.query<{ metadata:{ bypass_advance_horizon_used:boolean } }>("select metadata from public.audit_logs where action='calendar_event.approved' and entity_id=$1 and metadata->>'commitment_id'=$2",[events[3],replacement])).rows[0].metadata.bypass_advance_horizon_used).toBe(false);
      }
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("requires contact for effective future room requests and records an in-horizon approval accurately", async () => {
    const rollback = new Error("rollback in-horizon approval");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const portal=(await tx.query<{ value:{ events:Record<string,unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value",[refs[2],sessions[2]])).rows[0].value;
      const event=portal.events.find(row => row.id===events[3])!;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)",[refs[2],sessions[2],events[3],JSON.stringify({ ...event,scope:"ministry",rooms:[],setup_minutes:0,cleanup_minutes:0,schedule:{ ...(event.schedule as object),start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)",[refs[2],sessions[2]]);
      // Model an occurrence-specific room addition with no event-wide room template.
      await tx.query(`insert into public.calendar_submission_room_requests(submission_occurrence_id,room_id,origin)
        select o.id,$2,'exception' from public.calendar_submission_occurrences o join public.calendar_event_submissions s on s.id=o.submission_id
        where s.event_id=$1 and s.plan_revision=1`,[events[3],room]);
      await tx.query("update public.rooms set max_advance_value=30,max_advance_unit='day' where id=$1",[room]);
      await tx.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify({ role:"authenticated",sub:admin })]);
      expect((await tx.query<{ requires_room_contact:boolean }>("select * from public.calendar_staff_room_contact_requirements() where submission_id=(select id from public.calendar_event_submissions where event_id=$1 and plan_revision=1)",[events[3]])).rows[0].requires_room_contact).toBe(true);
      await tx.exec("savepoint missing_contact");
      await expect(tx.query("select public.calendar_approve_event($1,1,null,null,null)",[events[3]])).rejects.toMatchObject({ code:"RAR11" });
      await tx.exec("rollback to savepoint missing_contact");
      await tx.query("select public.calendar_approve_event($1,1,'Test','Planner','+15125550123')",[events[3]]);
      const audit=(await tx.query<{ metadata:{ bypass_advance_horizon_used:boolean } }>("select metadata from public.audit_logs where action='calendar_event.approved' and entity_id=$1 order by created_at desc limit 1",[events[3]])).rows[0];
      expect(audit.metadata.bypass_advance_horizon_used).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("atomically creates a private first approval and a matching long-range room hold", async () => {
    const rollback = new Error("rollback private approval fixture");
    const initialNotices = (await db.query<{ n: number }>("select count(*)::int as n from public.system_email_logs where event_type like 'calendar_event_%'")).rows[0].n;
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role: "service_role" })]);
      const portal = (await tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[2],sessions[2]])).rows[0].value;
      const event = portal.events.find(row => row.id === events[3])!;
      const schedule = event.schedule as Record<string, unknown>;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[2],sessions[2],events[3],JSON.stringify({ ...event, setup_minutes: 0, cleanup_minutes: 0, schedule: { ...schedule,start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      await tx.query("update public.rooms set max_advance_value=1,max_advance_unit='day' where id=$1", [room]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      const commitment = (await tx.query<{ id: string }>("select private.calendar_approve_initial($1,1,'Test','Planner','+15125550123') as id", [events[3]])).rows[0].id;
      expect((await tx.query<{ metadata:{ bypass_advance_horizon_used:boolean } }>("select metadata from public.audit_logs where action='calendar_event.approved' and entity_id=$1 order by created_at desc limit 1",[events[3]])).rows[0].metadata.bypass_advance_horizon_used).toBe(true);
      const rows = await tx.query<{ status: string; calendar_commitment_id: string }>("select status,calendar_commitment_id from public.reservations where calendar_commitment_id=$1", [commitment]);
      expect(rows.rows).toEqual([{ status:"approved",calendar_commitment_id:commitment }]);
      const hold = (await tx.query<{ id: string }>("select id from public.reservations where calendar_commitment_id=$1", [commitment])).rows[0].id;
      expect((await tx.query<{ commitment_id: string; event_id: string }>("select * from public.calendar_reservation_link($1)", [hold])).rows[0]).toMatchObject({ commitment_id:commitment,event_id:events[3] });
      await tx.exec("savepoint ordinary_mutation");
      await expect(tx.query("select public.cancel_reservation($1,'Ordinary cancellation')", [hold])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint ordinary_mutation");
      await expect(tx.query("select public.update_admin_notes($1,'Ordinary edit')", [hold])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint ordinary_mutation");
      await expect(tx.query("select private.queue_email($1,'planner@example.org','reservation_confirmed')", [hold])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint ordinary_mutation");
      expect((await tx.query<{ n: number }>(`select count(*)::int as n from public.calendar_resource_allocations a
        join public.calendar_submission_occurrences o on o.id=a.submission_occurrence_id
        join public.calendar_event_commitments c on c.submission_id=o.submission_id
        where c.id=$1 and a.status='confirmed'`, [commitment])).rows[0].n).toBe(1);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.email_logs where reservation_id in (select id from public.reservations where calendar_commitment_id=$1)", [commitment])).rows[0].n).toBe(0);
      const emailsBefore = (await tx.query<{ n: number }>("select count(*)::int as n from public.system_email_logs where event_type='calendar_event_approved'")).rows[0].n;
      const notificationsBefore = (await tx.query<{ n: number }>("select count(*)::int as n from public.notifications where type='calendar_event'")).rows[0].n;
      expect(emailsBefore).toBeGreaterThan(0);
      expect((await tx.query<{ id: string }>("select private.calendar_approve_initial($1,1,'Test','Planner','+15125550123') as id", [events[3]])).rows[0].id).toBe(commitment);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.reservations where calendar_commitment_id=$1", [commitment])).rows[0].n).toBe(1);
      await tx.query("select private.queue_calendar_event_notice($1,'approved',$2,null)", [commitment,admin]);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.system_email_logs where event_type='calendar_event_approved'")).rows[0].n).toBe(emailsBefore);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.notifications where type='calendar_event'")).rows[0].n).toBe(notificationsBefore);
      const emailId = (await tx.query<{ id: string }>("select id from public.system_email_logs where event_type='calendar_event_approved' limit 1")).rows[0].id;
      await tx.query("select public.complete_system_email($1,'failed',null,'Simulated delivery failure')", [emailId]);
      const failureAlerts = (await tx.query<{ n: number }>("select count(*)::int as n from public.notifications where type='email_failed'")).rows[0].n;
      await tx.query("select public.complete_system_email($1,'failed',null,'Simulated retry failure')", [emailId]);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.notifications where type='email_failed'")).rows[0].n).toBe(failureAlerts);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from private.calendar_reservation_capabilities where transaction_id=txid_current()")).rows[0].n).toBe(0);
      // A historical occurrence is inserted as fixture data; its existing allocation
      // must survive reapproval and cancellation of future dates.
      const pastOccurrence = (await tx.query<{ id: string }>(`insert into public.calendar_event_occurrences(event_id,source_key,schedule_revision,
        local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
        select $1,'historical-fixture',1,(current_date-1)+time '10:00',(current_date-1)+time '11:00','America/Chicago',false,
          ((current_date-1)+time '10:00') at time zone 'America/Chicago',((current_date-1)+time '11:00') at time zone 'America/Chicago',
          ((current_date-1)+time '10:00') at time zone 'America/Chicago',((current_date-1)+time '11:00') at time zone 'America/Chicago' returning id`, [events[3]])).rows[0].id;
      const pastSnapshot = (await tx.query<{ id: string }>(`insert into public.calendar_submission_occurrences(submission_id,occurrence_id,logical_occurrence_id,
        local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
        select c.submission_id,o.id,o.logical_occurrence_id,o.local_start,o.local_end,o.timezone,o.all_day,o.start_at,o.end_at,o.occupancy_start,o.occupancy_end
        from public.calendar_event_commitments c cross join public.calendar_event_occurrences o where c.id=$1 and o.id=$2 returning public.calendar_submission_occurrences.id`, [commitment,pastOccurrence])).rows[0].id;
      await tx.query("insert into public.calendar_submission_resource_requests values($1,$2,'template',1,null)", [pastSnapshot,resource]);
      const pastAllocation = (await tx.query<{ id: string }>(`insert into public.calendar_resource_allocations(submission_occurrence_id,resource_id,quantity,occupancy_start,occupancy_end,created_by)
        select id,$2,1,occupancy_start,occupancy_end,$3 from public.calendar_submission_occurrences where id=$1 returning id`, [pastSnapshot,resource,admin])).rows[0].id;
      await tx.query("select public.calendar_request_plan_changes($1,'Revise details')", [plans[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const revisedPortal = (await tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[2],sessions[2]])).rows[0].value;
      const revised = revisedPortal.events.find(row => row.id === events[3])!;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[2],sessions[2],events[3],JSON.stringify({ ...revised,title:"Updated details" })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      const revisedPast = (await tx.query<{ id: string }>(`insert into public.calendar_submission_occurrences(submission_id,occurrence_id,logical_occurrence_id,
        local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
        select s.id,o.occurrence_id,o.logical_occurrence_id,o.local_start,o.local_end,o.timezone,o.all_day,o.start_at,o.end_at,o.occupancy_start,o.occupancy_end
        from public.calendar_event_submissions s cross join public.calendar_submission_occurrences o
        where s.event_id=$1 and s.plan_revision=2 and o.id=$2 returning public.calendar_submission_occurrences.id`, [events[3],pastSnapshot])).rows[0].id;
      await tx.query("insert into public.calendar_submission_resource_requests values($1,$2,'template',1,null)", [revisedPast,resource]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      await tx.exec("savepoint historical_tamper");
      await tx.query("insert into public.calendar_submission_room_requests values($1,$2,'template')", [revisedPast,room]);
      await expect(tx.query("select private.calendar_approve_initial($1,2,'Test','Planner','+15125550123',$2)", [events[3],commitment])).rejects.toMatchObject({ code:"RAR03" });
      await tx.exec("rollback to savepoint historical_tamper");
      const revisedConflicts = (await tx.query<{ conflict_type: string; event_id: string }>("select * from private.calendar_current_conflicts() where event_id=$1", [events[3]])).rows;
      expect(revisedConflicts.some(c => ["room_reservation","resource_capacity","resource_planning"].includes(c.conflict_type))).toBe(false);
      await tx.query("select public.calendar_request_plan_changes($1,'Coordinate events')", [plans[1]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const otherPortal = (await tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[1],sessions[1]])).rows[0].value;
      const other = otherPortal.events.find(row => row.id === events[1])!;
      const otherSchedule = other.schedule as Record<string, unknown>;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[1],sessions[1],events[1],JSON.stringify({ ...other,setup_minutes:0,cleanup_minutes:0,schedule:{ ...otherSchedule,start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[1],sessions[1]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      const toResolve = (await tx.query<{ fingerprint: string; classification: string; conflict_type: string }>(`select c.* from private.calendar_current_conflicts() c
        where c.event_id=$1 or c.other_event_id=$1 or (c.conflict_type='resource_planning' and exists
          (select 1 from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) p where p->>'event_id'=$1::text))`, [events[3]])).rows;
      expect(toResolve.map(c => c.conflict_type)).toEqual(expect.arrayContaining(["room_planning","resource_planning","church_wide_overlap"]));
      expect(toResolve.some(c => c.classification==="hard")).toBe(false);
      for (const conflict of toResolve) {
        await tx.query("select public.calendar_record_conflict_decision($1,$2,'Reviewed',$3)",
          [conflict.fingerprint,conflict.classification==="planning" ? "advance" : "acknowledge",conflict.classification==="planning" ? events[3] : null]);
      }
      const replacement = (await tx.query<{ id: string }>("select private.calendar_approve_initial($1,2,'Test','Planner','+15125550123',$2) as id", [events[3],commitment])).rows[0].id;
      const history=(await tx.query<{ status:string }>("select * from public.calendar_master_entries(current_date-1,current_date-1) where event_id=$1",[events[3]])).rows;
      expect(history).toHaveLength(1); expect(history[0].status).toBe("approved");
      expect((await tx.query<{ status: string }>("select status from public.calendar_resource_allocations where id=$1", [pastAllocation])).rows[0].status).toBe("confirmed");
      expect((await tx.query<{ state: string }>("select state from public.calendar_event_commitments where id=$1", [commitment])).rows[0].state).toBe("replaced");
      expect((await tx.query<{ status: string }>("select status from public.reservations where calendar_commitment_id=$1", [commitment])).rows[0].status).toBe("cancelled");
      expect((await tx.query<{ status: string }>("select status from public.reservations where calendar_commitment_id=$1", [replacement])).rows[0].status).toBe("approved");
      await tx.exec("savepoint notification_failure");
      await tx.exec(`create function private.test_calendar_notice_failure() returns trigger language plpgsql as $$
        begin if new.event_type='calendar_event_cancelled' then raise exception 'Simulated outbox failure'; end if; return new; end; $$;
        create trigger test_calendar_notice_failure before insert on public.system_email_logs for each row execute function private.test_calendar_notice_failure()`);
      await expect(tx.query("select private.calendar_cancel_commitment($1,$2,'Schedule cancelled')", [events[3],replacement])).rejects.toMatchObject({ code:"P0001" });
      await tx.exec("rollback to savepoint notification_failure");
      expect((await tx.query<{ state: string }>("select state from public.calendar_event_commitments where id=$1", [replacement])).rows[0].state).toBe("active");
      expect((await tx.query<{ status: string }>("select status from public.reservations where calendar_commitment_id=$1", [replacement])).rows[0].status).toBe("approved");
      expect((await tx.query<{ n: number }>(`select count(*)::int as n from public.calendar_resource_allocations a
        join public.calendar_submission_occurrences o on o.id=a.submission_occurrence_id join public.calendar_event_commitments c on c.submission_id=o.submission_id
        where c.id=$1 and a.status='confirmed'`, [replacement])).rows[0].n).toBe(1);
      await tx.query("select private.calendar_cancel_commitment($1,$2,'Schedule cancelled')", [events[3],replacement]);
      expect((await tx.query<{ status: string }>("select status from public.calendar_resource_allocations where id=$1", [pastAllocation])).rows[0].status).toBe("confirmed");
      expect((await tx.query<{ event_type: string }>("select distinct event_type from public.system_email_logs where event_type like 'calendar_event_%' order by event_type")).rows.map(row => row.event_type)).toEqual(["calendar_event_approved","calendar_event_cancelled","calendar_event_replaced"]);
      expect((await tx.query<{ state: string }>("select state from public.calendar_event_commitments where id=$1", [replacement])).rows[0].state).toBe("cancelled");
      expect((await tx.query<{ id: string; state: string }>("select * from public.calendar_staff_latest_commitments() where event_id=$1", [events[3]])).rows[0]).toMatchObject({ id:replacement,state:"cancelled" });
      expect((await tx.query<{ status: string }>("select status from public.reservations where calendar_commitment_id=$1", [replacement])).rows[0].status).toBe("cancelled");
      expect((await tx.query<{ n: number }>(`select count(*)::int as n from public.calendar_resource_allocations a
        join public.calendar_submission_occurrences o on o.id=a.submission_occurrence_id
        join public.calendar_event_commitments c on c.submission_id=o.submission_id
        where c.id=$1 and a.status='confirmed'`, [replacement])).rows[0].n).toBe(0);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from private.calendar_reservation_capabilities where transaction_id=txid_current()")).rows[0].n).toBe(0);
      throw rollback;
    })).rejects.toBe(rollback);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.system_email_logs where event_type like 'calendar_event_%'")).rows[0].n).toBe(initialNotices);
    expect((await db.query<{ n: number }>("select count(*)::int as n from public.calendar_event_commitments where event_id=$1", [events[3]])).rows[0].n).toBe(0);
  });

  it("queues one changes-request notice per planner and preserves it transactionally", async () => {
    const rollback = new Error("rollback plan notice fixture");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      await tx.query("select public.calendar_request_plan_changes($1,'Please adjust the time')", [plans[0]]);
      const notices = (await tx.query<{ payload: { calendar_notice: { reason: string } } }>("select payload from public.system_email_logs where event_type='calendar_plan_changes_requested'")).rows;
      expect(notices).toHaveLength(1);
      expect(notices[0].payload.calendar_notice.reason).toBe("Please adjust the time");
      await tx.query("update public.ministry_calendar_plans set submission_status='changes_requested' where id=$1", [plans[0]]);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.system_email_logs where event_type='calendar_plan_changes_requested'")).rows[0].n).toBe(1);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("rolls back every hold and allocation if the third room insert fails", async () => {
    const rollback = new Error("rollback multi-room fixture");
    await expect(db.transaction(async tx => {
      const secondRoom = await createRoom(tx);
      const thirdRoom = await createRoom(tx);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const portal = (await tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[2],sessions[2]])).rows[0].value;
      const event = portal.events.find(row => row.id===events[3])!;
      const schedule = event.schedule as Record<string, unknown>;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[2],sessions[2],events[3],JSON.stringify({ ...event,rooms:[room,secondRoom,thirdRoom],setup_minutes:0,cleanup_minutes:0,schedule:{ ...schedule,start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      await tx.exec(`create function private.test_calendar_third_hold_failure() returns trigger language plpgsql as $$
        begin if new.calendar_commitment_id is not null and (select count(*) from public.reservations where calendar_commitment_id=new.calendar_commitment_id)=2
          then raise exception 'Simulated third hold failure'; end if; return new; end; $$;
        create trigger reservations_99_test_failure before insert on public.reservations for each row execute function private.test_calendar_third_hold_failure()`);
      await tx.exec("savepoint failed_approval");
      await expect(tx.query("select private.calendar_approve_initial($1,1,'Test','Planner','+15125550123')", [events[3]])).rejects.toMatchObject({ code:"P0001" });
      await tx.exec("rollback to savepoint failed_approval");
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.calendar_event_commitments where event_id=$1", [events[3]])).rows[0].n).toBe(0);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.reservations where calendar_commitment_id is not null")).rows[0].n).toBe(0);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.calendar_resource_allocations")).rows[0].n).toBe(0);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.system_email_logs where event_type='calendar_event_approved'")).rows[0].n).toBe(0);
      expect((await tx.query<{ n: number }>("select count(*)::int as n from private.calendar_reservation_capabilities where transaction_id=txid_current()")).rows[0].n).toBe(0);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("rejects missing and stale conflict decisions before creating commitments", async () => {
    const rollback = new Error("rollback decision fixture");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      await tx.exec("savepoint missing_decisions");
      await expect(tx.query("select private.calendar_approve_initial($1,1,'Test','Planner','+15125550123')", [events[3]])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint missing_decisions");
      const current = (await tx.query<{ fingerprint: string; classification: string }>(`select c.* from private.calendar_current_conflicts() c
        where c.event_id=$1 or c.other_event_id=$1 or (c.conflict_type='resource_planning' and exists
          (select 1 from jsonb_array_elements(coalesce(c.details->'participants','[]'::jsonb)) p where p->>'event_id'=$1::text))`, [events[3]])).rows;
      expect(current.length).toBeGreaterThan(0);
      for (const c of current) await tx.query("select public.calendar_record_conflict_decision($1,$2,'Reviewed',$3)",
        [c.fingerprint,c.classification==="planning" ? "advance" : "acknowledge",c.classification==="planning" ? events[3] : null]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:superAdmin })]);
      await tx.query("select public.calendar_conflict_policy_save(101)");
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      await tx.exec("savepoint stale_decisions");
      await expect(tx.query("select private.calendar_approve_initial($1,1,'Test','Planner','+15125550123')", [events[3]])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint stale_decisions");
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.calendar_event_commitments where event_id=$1", [events[3]])).rows[0].n).toBe(0);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("enforces staff authorization through the proposed approval and cancellation interfaces", async () => {
    const rollback = new Error("rollback interface fixture");
    const inactive = await createStaff(db, "admin", { active:false });
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const portal = (await tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[2],sessions[2]])).rows[0].value;
      const event = portal.events.find(row => row.id===events[3])!;
      const schedule = event.schedule as Record<string, unknown>;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[2],sessions[2],events[3],JSON.stringify({ ...event,setup_minutes:0,cleanup_minutes:0,schedule:{ ...schedule,start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      await tx.exec("savepoint role_test");
      await tx.exec("set local role anon");
      await expect(tx.query("select public.calendar_approve_event($1,1,'Test','Planner','+15125550123')", [events[3]])).rejects.toMatchObject({ code:"42501" });
      await tx.exec("rollback to savepoint role_test");
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:inactive })]);
      await expect(tx.query("select public.calendar_approve_event($1,1,'Test','Planner','+15125550123')", [events[3]])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint role_test");
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      const result = await tx.query<{ id: string }>("select public.calendar_approve_event($1,1,'Test','Planner','+15125550123') as id", [events[3]]);
      await tx.query("select public.calendar_cancel_event($1,$2,'Testing cancellation')", [events[3],result.rows[0].id]);
      await tx.exec("reset role");
      expect((await tx.query<{ state: string }>("select state from public.calendar_event_commitments where id=$1", [result.rows[0].id])).rows[0].state).toBe("cancelled");
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("keeps approved commitments visible and cancellable after a ministry is removed", async () => {
    const rollback = new Error("rollback removed-ministry fixture");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const portal = (await tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[2],sessions[2]])).rows[0].value;
      const event = portal.events.find(row => row.id===events[3])!;
      const schedule = event.schedule as Record<string, unknown>;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[2],sessions[2],events[3],JSON.stringify({ ...event,setup_minutes:0,cleanup_minutes:0,schedule:{ ...schedule,start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      const commitment = (await tx.query<{ id: string }>("select private.calendar_approve_initial($1,1,'Test','Planner','+15125550123') as id", [events[3]])).rows[0].id;
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:superAdmin })]);
      await tx.query("select public.remove_calendar_ministry($1)", [plans[2]]);
      const active = (await tx.query<{ id: string; plan_active: boolean }>("select * from public.calendar_staff_active_commitments() where id=$1", [commitment])).rows[0];
      expect(active).toMatchObject({ id:commitment,plan_active:false });
      await tx.query("select private.calendar_cancel_commitment($1,$2,'Ministry withdrew')", [events[3],commitment]);
      expect((await tx.query<{ state: string }>("select state from public.calendar_event_commitments where id=$1", [commitment])).rows[0].state).toBe("cancelled");
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("treats an overlapping approved exclusive event as a hard on-site conflict", async () => {
    const rollback = new Error("rollback exclusive fixture");
    await expect(db.transaction(async tx => {
      const commitment = (await tx.query<{ id: string }>(`insert into public.calendar_event_commitments(event_id,submission_id,approved_by)
        select event_id,id,$2 from public.calendar_event_submissions where event_id=$1 limit 1 returning id`, [events[0],admin])).rows[0].id;
      const rows = (await tx.query<{ classification: string; conflict_type: string; event_id: string }>("select * from private.calendar_current_conflicts()" )).rows;
      expect(rows.some(row => row.event_id===events[1] && row.conflict_type==="approved_exclusive" && row.classification==="hard")).toBe(true);
      expect(rows.some(row => row.event_id===events[2] && row.conflict_type==="approved_exclusive")).toBe(false);
      expect(rows.some(row => row.event_id===events[0])).toBe(false);
      await tx.query(`insert into public.calendar_commitment_occurrence_cancellations(commitment_id,submission_occurrence_id,logical_occurrence_id,reason,cancelled_by)
        select $1,o.id,o.logical_occurrence_id,'Cancelled date',$2 from public.calendar_submission_occurrences o
        join public.calendar_event_commitments c on c.submission_id=o.submission_id where c.id=$1`, [commitment,admin]);
      expect((await tx.query<{ conflict_type: string; event_id: string }>("select * from private.calendar_current_conflicts()" )).rows
        .some(row => row.event_id===events[1] && row.conflict_type==="approved_exclusive")).toBe(false);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("cancels one future date, retains the others, and preserves that cancellation on replacement", async () => {
    const rollback = new Error("rollback occurrence cancellation fixture");
    await expect(db.transaction(async tx => {
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const portal = (await tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[2],sessions[2]])).rows[0].value;
      const event = portal.events.find(row => row.id===events[3])!;
      const schedule = event.schedule as Record<string, unknown>;
      const nextDate = (await tx.query<{ date: string }>("select ($1::date+1)::text as date", [date])).rows[0].date;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[2],sessions[2],events[3],JSON.stringify({ ...event,setup_minutes:0,cleanup_minutes:0,
        schedule:{ ...schedule,kind:"recurring",frequency:"daily",interval_count:1,start_date:date,end_date:nextDate,start_time:"15:00",end_time:"16:00" } })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      const commitment = (await tx.query<{ id: string }>("select private.calendar_approve_initial($1,1,'Test','Planner','+15125550123') as id", [events[3]])).rows[0].id;
      const occurrences = (await tx.query<{ id: string; logical_occurrence_id: string }>(`select o.id,o.logical_occurrence_id from public.calendar_submission_occurrences o
        join public.calendar_event_commitments c on c.submission_id=o.submission_id where c.id=$1 order by o.start_at`, [commitment])).rows;
      expect(occurrences).toHaveLength(2);
      await tx.query("select private.calendar_cancel_occurrence($1,$2,$3,'One date cancelled')", [events[3],commitment,occurrences[0].id]);
      const holds = (await tx.query<{ status: string }>("select status from public.reservations where calendar_commitment_id=$1 order by start_at", [commitment])).rows;
      expect(holds.map(r => r.status)).toEqual(["cancelled","approved"]);
      const submission = (await tx.query<{ submission_id: string }>("select submission_id from public.calendar_event_commitments where id=$1", [commitment])).rows[0].submission_id;
      const staffDates = (await tx.query<{ value: { id: string; cancelled: boolean; can_cancel: boolean; commitment_id: string }[] }>("select public.calendar_staff_occurrences($1) as value", [submission])).rows[0].value;
      expect(staffDates.find(o => o.id===occurrences[0].id)).toMatchObject({ cancelled:true,can_cancel:false,commitment_id:commitment });
      expect(staffDates.find(o => o.id===occurrences[1].id)).toMatchObject({ cancelled:false,can_cancel:true,commitment_id:commitment });
      const cancellationEmails = (await tx.query<{ n: number }>("select count(*)::int as n from public.system_email_logs where event_type='calendar_event_occurrence_cancelled'")).rows[0].n;
      expect(cancellationEmails).toBeGreaterThan(0);
      await tx.exec("savepoint repeated_cancel");
      await expect(tx.query("select private.calendar_cancel_occurrence($1,$2,$3,'Repeat')", [events[3],commitment,occurrences[0].id])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint repeated_cancel");
      await expect(tx.query("select private.calendar_cancel_occurrence($1,$2,$3,'Wrong event')", [events[0],commitment,occurrences[1].id])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint repeated_cancel");
      await expect(tx.query("delete from public.calendar_commitment_occurrence_cancellations where commitment_id=$1", [commitment])).rejects.toMatchObject({ code:"RAR09" });
      await tx.exec("rollback to savepoint repeated_cancel");
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.system_email_logs where event_type='calendar_event_occurrence_cancelled'")).rows[0].n).toBe(cancellationEmails);
      await tx.query("select public.calendar_request_plan_changes($1,'Revise event')", [plans[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"service_role" })]);
      const revisedPortal = (await tx.query<{ value: { events: Record<string, unknown>[] } }>("select public.calendar_planner_portal($1,$2) as value", [refs[2],sessions[2]])).rows[0].value;
      const revised = revisedPortal.events.find(row => row.id===events[3])!;
      await tx.query("select public.calendar_save_event_draft($1,$2,$3,$4::jsonb)", [refs[2],sessions[2],events[3],JSON.stringify({ ...revised,title:"Revised recurring event",rooms:[] })]);
      await tx.query("select public.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]);
      await tx.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ role:"authenticated",sub:admin })]);
      const replacement = (await tx.query<{ id: string }>("select private.calendar_approve_initial($1,2,null,null,null,$2) as id", [events[3],commitment])).rows[0].id;
      expect((await tx.query<{ n: number }>("select count(*)::int as n from public.reservations where calendar_commitment_id=$1 and status='approved'", [replacement])).rows[0].n).toBe(0);
      expect((await tx.query<{ status:string }>("select status from public.calendar_master_entries($1::date,$1::date+1) where event_id=$2 order by starts_at",[date,events[3]])).rows.map(row => row.status)).toEqual(["cancelled","approved"]);
      expect((await tx.query<{ logical_occurrence_id: string }>("select logical_occurrence_id from public.calendar_commitment_occurrence_cancellations where commitment_id=$1", [replacement])).rows[0].logical_occurrence_id).toBe(occurrences[0].logical_occurrence_id);
      throw rollback;
    })).rejects.toBe(rollback);
  });

  it("keeps calendar reservation capabilities private and scopes the horizon exception to their transaction", async () => {
    const snapshot = (await db.query<{ id: string }>(`select o.id from public.calendar_submission_occurrences o
      join public.calendar_event_submissions s on s.id=o.submission_id where s.event_id=$1 limit 1`, [events[0]])).rows[0].id;
    const id = crypto.randomUUID();
    const starts = (await db.query<{ start_at: string; end_at: string }>(`select
      (((now() at time zone 'America/Chicago')::date+300)+time '10:00') at time zone 'America/Chicago' as start_at,
      (((now() at time zone 'America/Chicago')::date+300)+time '11:00') at time zone 'America/Chicago' as end_at`)).rows[0];
    const insert = `insert into public.reservations(id,reference_code,status,source,room_id,start_at,end_at,
      requester_first_name,requester_last_name,requester_email,requester_phone,other_ministry_name,purpose,estimated_attendance,
      approval_required_at_submission,food_drinks_allowed_at_submission,room_capacity_at_submission,guest_token_hash,guest_token_seed,
      calendar_submission_occurrence_id,calendar_commitment_id) values ($1,private.generate_reference_code(),'approved','admin',$2,$3,$4,
      'Test','Planner','planner@example.org','+15125550123','Test','Calendar',10,false,false,0,
      sha256(convert_to(gen_random_uuid()::text,'UTF8')),uuid_send(gen_random_uuid()),$5,$6)`;
    const makeSnapshot = async (tx: Queryable, startAt: string, endAt: string) => {
      const logical = crypto.randomUUID();
      const occurrence = (await tx.query<{ id: string }>(`insert into public.calendar_event_occurrences(event_id,logical_occurrence_id,source_key,schedule_revision,
        local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
        values ($1,$2::uuid,$2::uuid::text,1,$3::timestamptz at time zone 'America/Chicago',$4::timestamptz at time zone 'America/Chicago',
          'America/Chicago',false,$3,$4,$3,$4) returning id`, [events[1],logical,startAt,endAt])).rows[0].id;
      const result = (await tx.query<{ id: string }>(`insert into public.calendar_submission_occurrences(submission_id,occurrence_id,logical_occurrence_id,
        local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
        select s.id,$2,$3,$4::timestamptz at time zone 'America/Chicago',$5::timestamptz at time zone 'America/Chicago',
          'America/Chicago',false,$4,$5,$4,$5 from public.calendar_event_submissions s where s.event_id=$1 limit 1 returning id`,
        [events[1],occurrence,logical,startAt,endAt])).rows[0].id;
      await tx.query("insert into public.calendar_submission_room_requests(submission_occurrence_id,room_id,origin) values ($1,$2,'template')", [result,room]);
      const commitment = (await tx.query<{ id: string }>(`insert into public.calendar_event_commitments(event_id,submission_id,approved_by)
        select s.event_id,s.id,$2 from public.calendar_event_submissions s where s.event_id=$1 limit 1 returning id`, [events[1],admin])).rows[0].id;
      return { snapshot: result, commitment };
    };
    await expect(asRole(db, "authenticated", tx => tx.query("insert into private.calendar_reservation_capabilities values (txid_current(),$1,$2,'create')", [id,snapshot]), admin)).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "service_role", tx => tx.query("insert into private.calendar_reservation_capabilities values (txid_current(),$1,$2,'create')", [id,snapshot]))).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "authenticated", tx => tx.query("update private.calendar_commitment_serialization set revision=0"), admin)).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "service_role", tx => tx.query("update private.calendar_commitment_serialization set revision=0"))).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "service_role", tx => tx.query("select private.calendar_submit_plan($1,$2,'',false)", [refs[2],sessions[2]]))).rejects.toMatchObject({ code: "42501" });
    await expect(db.query(insert, [id,room,starts.start_at,starts.end_at,snapshot,null])).rejects.toMatchObject({ code: "RAR09" });
    await expect(insertReservation(db, { roomId: room, startAt: starts.start_at, endAt: starts.end_at })).rejects.toMatchObject({ code: "RAR02" });
    const foodTimes = (await db.query<{ start_at: string; end_at: string }>("select occupancy_start as start_at,occupancy_end as end_at from public.calendar_submission_occurrences where id=$1", [snapshot])).rows[0];
    await expect(db.transaction(async tx => {
      const commitment = (await tx.query<{ id: string }>(`insert into public.calendar_event_commitments(event_id,submission_id,approved_by)
        select event_id,id,$2 from public.calendar_event_submissions where event_id=$1 limit 1 returning id`, [events[0],admin])).rows[0].id;
      await tx.query("insert into private.calendar_reservation_capabilities values (txid_current(),$1,$2,'create')", [id,snapshot]);
      await tx.query(insert, [id,room,foodTimes.start_at,foodTimes.end_at,snapshot,commitment]);
    })).rejects.toMatchObject({ code: "RAR09" });
    const rollback = new Error("rollback test reservation");
    await expect(db.transaction(async tx => {
      const matchingSnapshot = await makeSnapshot(tx, starts.start_at, starts.end_at);
      await tx.exec("savepoint ledger_test");
      await expect(tx.query("insert into public.calendar_event_commitments(event_id,submission_id,approved_by) select event_id,submission_id,approved_by from public.calendar_event_commitments where id=$1", [matchingSnapshot.commitment])).rejects.toMatchObject({ code: "23505" });
      await tx.exec("rollback to savepoint ledger_test");
      await expect(tx.query("update public.calendar_event_commitments set event_id=$2 where id=$1", [matchingSnapshot.commitment,events[0]])).rejects.toMatchObject({ code: "RAR09" });
      await tx.exec("rollback to savepoint ledger_test");
      await expect(tx.query("delete from public.calendar_event_commitments where id=$1", [matchingSnapshot.commitment])).rejects.toMatchObject({ code: "RAR09" });
      await tx.exec("rollback to savepoint ledger_test");
      await tx.query("insert into private.calendar_reservation_capabilities values (txid_current(),$1,$2,'create')", [id,matchingSnapshot.snapshot]);
      await tx.exec("savepoint snapshot_test");
      await expect(tx.query(insert, [id,room,starts.start_at,new Date(new Date(starts.end_at).getTime() + 30 * 60 * 1000).toISOString(),matchingSnapshot.snapshot,matchingSnapshot.commitment])).rejects.toMatchObject({ code: "RAR09" });
      await tx.exec("rollback to savepoint snapshot_test");
      await tx.query(insert, [id,room,starts.start_at,starts.end_at,matchingSnapshot.snapshot,matchingSnapshot.commitment]);
      await tx.query("delete from private.calendar_reservation_capabilities where reservation_id=$1", [id]);
      await tx.exec("savepoint guard_test");
      await expect(tx.query("update public.calendar_event_commitments set state='cancelled',closed_by=$2,closed_at=now(),close_reason='Cancelled' where id=$1", [matchingSnapshot.commitment,admin])).rejects.toMatchObject({ code: "RAR09" });
      await tx.exec("rollback to savepoint guard_test");
      await expect(tx.query("update public.reservations set admin_notes='ordinary edit' where id=$1", [id])).rejects.toMatchObject({ code: "RAR09" });
      await tx.exec("rollback to savepoint guard_test");
      await expect(tx.query("delete from public.reservations where id=$1", [id])).rejects.toMatchObject({ code: "RAR09" });
      await tx.exec("rollback to savepoint guard_test");
      await tx.query("insert into private.calendar_reservation_capabilities values (txid_current(),$1,$2,'cancel')", [id,matchingSnapshot.snapshot]);
      await expect(tx.query("update public.reservations set status='cancelled',purpose='tampered' where id=$1", [id])).rejects.toMatchObject({ code: "RAR09" });
      await tx.exec("rollback to savepoint guard_test");
      await tx.query("insert into private.calendar_reservation_capabilities values (txid_current(),$1,$2,'cancel')", [id,matchingSnapshot.snapshot]);
      await tx.query("update public.reservations set status='cancelled',cancelled_by_user_id=$2 where id=$1", [id,admin]);
      expect((await tx.query<{ status: string }>("select status from public.reservations where id=$1", [id])).rows[0].status).toBe("cancelled");
      await tx.query("update public.calendar_event_commitments set state='cancelled',closed_by=$2,closed_at=now(),close_reason='Cancelled' where id=$1", [matchingSnapshot.commitment,admin]);
      await tx.exec("savepoint closed_test");
      await expect(tx.query("update public.calendar_event_commitments set state='active',closed_by=null,closed_at=null,close_reason=null where id=$1", [matchingSnapshot.commitment])).rejects.toMatchObject({ code: "RAR09" });
      throw rollback;
    })).rejects.toBe(rollback);
    for (const [startTime,endTime] of [["02:00","03:00"],["10:07","11:00"],["23:00","01:00"]]) {
      const invalid = (await db.query<{ start_at: string; end_at: string }>(`select
        (((now() at time zone 'America/Chicago')::date+300)+$1::time) at time zone 'America/Chicago' as start_at,
        (((now() at time zone 'America/Chicago')::date+300+case when $2::time<$1::time then 1 else 0 end)+$2::time) at time zone 'America/Chicago' as end_at`, [startTime,endTime])).rows[0];
      await expect(db.transaction(async tx => {
        const matchingSnapshot = await makeSnapshot(tx, invalid.start_at, invalid.end_at);
        await tx.query("insert into private.calendar_reservation_capabilities values (txid_current(),$1,$2,'create')", [id,matchingSnapshot.snapshot]);
        await tx.query(insert, [id,room,invalid.start_at,invalid.end_at,matchingSnapshot.snapshot,matchingSnapshot.commitment]);
      })).rejects.toMatchObject({ code: "RAR04" });
    }
  });

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
    await expect(asRole(db, "anon", tx => tx.query("select public.calendar_approve_event($1,1,'A','B','+15125550123')", [events[0]]))).rejects.toMatchObject({ code: "42501" });
    await expect(asRole(db, "anon", tx => tx.query("select public.calendar_cancel_event($1,$2,'Reason')", [events[0],crypto.randomUUID()]))).rejects.toMatchObject({ code: "42501" });
    const disabled = await createStaff(db, "admin", { active:false });
    await expect(asRole(db, "authenticated", tx => tx.query("select public.calendar_cancel_event($1,$2,'Reason')", [events[0],crypto.randomUUID()]), disabled)).rejects.toMatchObject({ code: "RAR09" });
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
