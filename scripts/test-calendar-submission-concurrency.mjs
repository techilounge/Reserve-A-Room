// Use only an empty local calendar_race_* database. CALENDAR_TEST_ORDER is
// submission-first or approval-first; CALENDAR_TEST_ISOLATION selects the
// isolation level. This exercises actual planner submission and approval RPCs.
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const database = process.env.CALENDAR_TEST_DATABASE_URL;
const executable = process.env.CALENDAR_TEST_PSQL || "psql";
const isolation = process.env.CALENDAR_TEST_ISOLATION || "read committed";
const order = process.env.CALENDAR_TEST_ORDER || "submission-first";
if (!database || !["read committed", "repeatable read", "serializable"].includes(isolation) || !["submission-first", "approval-first"].includes(order)) throw new Error("Invalid test parameters.");
const url = new URL(database);
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search || url.hash || !/^\/calendar_race_[a-z0-9_]+$/.test(url.pathname)) throw new Error("Use an explicitly named local calendar_race_* database.");
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function psql(args = [], input = "", app = "phase6_submission_setup") {
  const child = spawn(executable, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", database, ...args], { env: { ...process.env, PGAPPNAME: app }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  child.stdin.end(input);
  return new Promise((resolve, reject) => { child.on("error", reject); child.on("close", code => resolve({ code,stdout:stdout.trim(),stderr:stderr.trim() })); });
}
async function sql(input) { const r = await psql([],input); if (r.code !== 0) throw new Error(r.stderr); return r.stdout; }
if (await sql("select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind in ('r','p');") !== "0") throw new Error("Test database must be empty.");
const stub = (await readFile("supabase/tests/support/supabase-stub.sql", "utf8"))
  .replace("create role anon nologin noinherit;", () => "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if; end $$;")
  .replace("create role authenticated nologin noinherit;", () => "do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if; end $$;")
  .replace("create role service_role nologin noinherit bypassrls;", () => "do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;");
await sql(stub);
for (const file of (await readdir("supabase/migrations")).filter(name => name.endsWith(".sql")).sort().map(name => path.join("supabase/migrations",name))) {
  const r = await psql(["-f",file]); if (r.code !== 0) throw new Error(`Migration ${file} failed: ${r.stderr}`);
}
const actor="11111111-1111-4111-8111-111111111111", event="22222222-2222-4222-8222-222222222222";
const reference="33333333-3333-4333-8333-333333333333", grant="44444444-4444-4444-8444-444444444444";
const session="ab".repeat(32);
await sql(`
insert into auth.users(id,email) values ('${actor}','race@example.org');
insert into public.profiles(id,email,full_name,role,active) values ('${actor}','race@example.org','Race Test','super_admin',true);
update private.calendar_planner_policies set enabled=true,privacy_version='p1',terms_version='t1';
do $fixture$
declare i integer; cycle_id uuid; plan_id uuid; grant_id uuid; submission_id uuid; occurrence_id uuid; start_at timestamptz;
begin
  start_at:=(((now() at time zone 'America/Chicago')::date+7)+time '10:00') at time zone 'America/Chicago';
  for i in 1..2 loop
    insert into public.calendar_cycles(name,start_date,end_date,submission_opens_at,submission_deadline,status)
      values ('Submission race '||i,current_date,current_date+30,now()-interval '1 day',now()+interval '1 day','open') returning id into cycle_id;
    insert into public.ministry_calendar_plans(cycle_id,ministry_id,reference_code,submission_status,submission_revision)
      select cycle_id,id,case when i=2 then '${reference}'::uuid else gen_random_uuid() end,case when i=1 then 'submitted' else 'draft' end,case when i=1 then 1 else 0 end
      from public.ministries limit 1 returning id into plan_id;
    insert into public.calendar_plan_access(id,plan_id,contact_name,contact_email,label,token_hash,token_seed,expires_at)
      values(case when i=2 then '${grant}'::uuid else gen_random_uuid() end,plan_id,'Race','planner'||i||'@example.org','additional',decode(repeat(i::text,64),'hex'),decode(repeat(i::text,32),'hex'),now()+interval '1 day') returning id into grant_id;
    if i=1 then
      insert into public.calendar_events(id,plan_id,title,scope,protection,visibility,location_type,estimated_attendance,status,revision)
        values('${event}',plan_id,'Existing event','ministry','exclusive','internal','church',1,'submitted',1);
      insert into public.calendar_event_submissions(event_id,plan_revision,submitted_by_grant,title,category,scope,protection,visibility,location_type,estimated_attendance,food_drinks_planned,setup_minutes,cleanup_minutes,schedule_kind,timezone,start_date,end_date,start_time,end_time,all_day)
        values('${event}',1,grant_id,'Existing event','other','ministry','exclusive','internal','church',1,false,0,0,'one_time','America/Chicago',(start_at at time zone 'America/Chicago')::date,(start_at at time zone 'America/Chicago')::date,'10:00','11:00',false) returning id into submission_id;
      insert into public.calendar_event_occurrences(event_id,source_key,schedule_revision,local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
        values('${event}','single',1,start_at at time zone 'America/Chicago',(start_at+interval '1 hour') at time zone 'America/Chicago','America/Chicago',false,start_at,start_at+interval '1 hour',start_at,start_at+interval '1 hour') returning id into occurrence_id;
      insert into public.calendar_submission_occurrences(submission_id,occurrence_id,logical_occurrence_id,local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
        select submission_id,o.id,o.logical_occurrence_id,o.local_start,o.local_end,o.timezone,o.all_day,o.start_at,o.end_at,o.occupancy_start,o.occupancy_end from public.calendar_event_occurrences o where o.id=occurrence_id;
    else
      insert into public.calendar_plan_sessions(grant_id,grant_version,session_hash,expires_at) values(grant_id,1,decode('${session}','hex'),now()+interval '1 day');
      insert into public.calendar_planner_acceptances(grant_id,privacy_version,terms_version) values(grant_id,'p1','t1');
    end if;
  end loop;
end $fixture$;
begin;
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.calendar_save_event_draft('${reference}','${session}',null,jsonb_build_object(
  'title','New proposal','scope','ministry','visibility','internal','location_type','church','estimated_attendance',1,
  'schedule',jsonb_build_object('kind','one_time','timezone','America/Chicago','all_day',false,
    'start_date',((now() at time zone 'America/Chicago')::date+7)::text,'end_date',((now() at time zone 'America/Chicago')::date+7)::text,
    'start_time','10:00','end_time','11:00')));
commit;
`);
const submit=`select set_config('request.jwt.claims','{"role":"service_role"}',true); select public.calendar_submit_plan('${reference}','${session}','',false);`;
const approve=`select set_config('request.jwt.claims','{"role":"authenticated","sub":"${actor}"}',true); select private.calendar_approve_initial('${event}',1,'Race','Planner','+15125550123');`;
const a = psql([],`begin isolation level ${isolation}; ${order==='submission-first' ? submit : approve} select pg_sleep(6); commit;`,"phase6_proposal_a");
let sleeping=false;
for (let i=0;i<60;i++) { if (await sql("select count(*) from pg_stat_activity where application_name='phase6_proposal_a' and wait_event='PgSleep'")==='1') { sleeping=true; break; } await sleep(100); }
if (!sleeping) throw new Error(`First transaction did not reach barrier: ${JSON.stringify(await a)}`);
const b = psql([],`begin isolation level ${isolation}; select count(*) from public.calendar_event_commitments; ${order==='submission-first' ? approve : submit} commit;`,"phase6_proposal_b");
let blocked=false;
for (let i=0;i<45;i++) { if (await sql("select count(*) from pg_stat_activity where application_name='phase6_proposal_b' and wait_event_type='Lock'")==='1') { blocked=true; break; } await sleep(100); }
const [first,second]=await Promise.all([a,b]);
if (!blocked || first.code!==0 || (order==='submission-first' && second.code===0) || (order==='approval-first' && isolation==='read committed' && second.code!==0) || (order==='approval-first' && isolation!=='read committed' && second.code===0)) throw new Error(JSON.stringify({ blocked,first,second }));
if (second.code!==0 && !/could not serialize|conflict decisions|blocks first/i.test(second.stderr)) throw new Error(second.stderr);
if (await sql("select count(*) from public.calendar_event_commitments where state='active'") !== (order==='approval-first' ? '1' : '0')) throw new Error("Unexpected active commitment count.");
console.log(`Real PostgreSQL ${isolation} ${order} proposal/approval race passed.`);
