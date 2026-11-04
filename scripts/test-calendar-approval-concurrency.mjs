// Run only against an empty local calendar_race_* PostgreSQL database.
// Set CALENDAR_TEST_PSQL, CALENDAR_TEST_DATABASE_URL and optionally
// CALENDAR_TEST_ISOLATION (read committed / repeatable read / serializable)
// and CALENDAR_TEST_SCENARIO (room / resource / exclusive).
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const executable = process.env.CALENDAR_TEST_PSQL || "psql";
const database = process.env.CALENDAR_TEST_DATABASE_URL;
const isolation = process.env.CALENDAR_TEST_ISOLATION ?? "read committed";
const scenario = process.env.CALENDAR_TEST_SCENARIO ?? "resource";
if (!["read committed", "repeatable read", "serializable"].includes(isolation)) throw new Error("Unsupported isolation level.");
if (!["room", "resource", "exclusive"].includes(scenario)) throw new Error("Unsupported race scenario.");
if (!database) throw new Error("Set CALENDAR_TEST_DATABASE_URL to an empty local calendar_race_* database.");
const url = new URL(database);
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search || url.hash || !/^\/calendar_race_[a-z0-9_]+$/.test(url.pathname)) {
  throw new Error("Refusing to run outside an explicitly named local calendar_race_* database.");
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function psql(args, input = "", app = "phase6_setup") {
  const child = spawn(executable, ["-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-d", database, ...args], {
    env: { ...process.env, PGAPPNAME: app }, windowsHide: true, stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", data => { stdout += data; });
  child.stderr.on("data", data => { stderr += data; });
  child.stdin.end(input);
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", code => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
  });
}
async function sql(input) {
  const result = await psql([], input);
  if (result.code !== 0) throw new Error(result.stderr || `psql exited ${result.code}`);
  return result.stdout;
}
if (await sql("select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','auth','storage') and c.relkind in ('r','p');") !== "0") {
  throw new Error("The test database is not empty; no changes were made.");
}
const stub = (await readFile("supabase/tests/support/supabase-stub.sql", "utf8"))
  .replace("create role anon nologin noinherit;", () => "do $$ begin if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin noinherit; end if; end $$;")
  .replace("create role authenticated nologin noinherit;", () => "do $$ begin if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin noinherit; end if; end $$;")
  .replace("create role service_role nologin noinherit bypassrls;", () => "do $$ begin if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin noinherit bypassrls; end if; end $$;");
await sql(stub);
for (const file of (await readdir("supabase/migrations")).filter(name => name.endsWith(".sql")).sort().map(name => path.join("supabase/migrations", name))) {
  const result = await psql(["-f", file]);
  if (result.code !== 0) throw new Error(`Migration ${file} failed: ${result.stderr}`);
}
const actor = "11111111-1111-4111-8111-111111111111";
const resource = "22222222-2222-4222-8222-222222222222";
const room = "44444444-4444-4444-8444-444444444444";
const snapshots = ["33333333-3333-4333-8333-333333333331", "33333333-3333-4333-8333-333333333332"];
await sql(`
insert into auth.users(id,email) values ('${actor}','race@example.org');
insert into public.profiles(id,email,full_name,role,active) values ('${actor}','race@example.org','Race Test','super_admin',true);
insert into public.calendar_resources(id,name,category,available_quantity) values ('${resource}','Race resource','equipment',1);
insert into public.rooms(id,name,slug,capacity) values ('${room}','Race room','race-room',20);
do $fixture$
declare i integer; cycle_id uuid; plan_id uuid; grant_id uuid; event_id uuid; submission_id uuid; occurrence_id uuid; snapshot_id uuid;
  start_at timestamptz := (((now() at time zone 'America/Chicago')::date+7)+time '10:00') at time zone 'America/Chicago';
begin
  for i in 1..2 loop
    insert into public.calendar_cycles(name,start_date,end_date,submission_opens_at,submission_deadline,status)
      values ('Race '||i,current_date,current_date+30,now()-interval '1 day',now()+interval '1 day','open') returning id into cycle_id;
    insert into public.ministry_calendar_plans(cycle_id,ministry_id,submission_status,submission_revision)
      select cycle_id,id,'submitted',1 from public.ministries limit 1 returning id into plan_id;
    insert into public.calendar_plan_access(plan_id,contact_name,contact_email,label,token_hash,token_seed,expires_at)
      values(plan_id,'Race','race'||i||'@example.org','additional',decode(repeat(i::text,64),'hex'),decode(repeat(i::text,32),'hex'),now()+interval '1 day') returning id into grant_id;
    insert into public.calendar_events(plan_id,title,scope,protection,visibility,location_type,estimated_attendance,status,revision)
      values(plan_id,'Race event','ministry',case when '${scenario}'='exclusive' and i=1 then 'exclusive' else 'normal' end,'internal','church',1,'submitted',1) returning id into event_id;
    insert into public.calendar_event_submissions(event_id,plan_revision,submitted_by_grant,title,category,scope,protection,visibility,
      location_type,estimated_attendance,food_drinks_planned,setup_minutes,cleanup_minutes,schedule_kind,timezone,start_date,end_date,start_time,end_time,all_day)
      values(event_id,1,grant_id,'Race event','other','ministry',case when '${scenario}'='exclusive' and i=1 then 'exclusive' else 'normal' end,'internal','church',1,false,0,0,'one_time','America/Chicago',
        (start_at at time zone 'America/Chicago')::date,(start_at at time zone 'America/Chicago')::date,time '10:00',time '11:00',false) returning id into submission_id;
    insert into public.calendar_event_occurrences(event_id,source_key,schedule_revision,local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
      values(event_id,'single',1,start_at at time zone 'America/Chicago',(start_at+interval '1 hour') at time zone 'America/Chicago','America/Chicago',false,start_at,start_at+interval '1 hour',start_at,start_at+interval '1 hour') returning id into occurrence_id;
    snapshot_id := case i when 1 then '${snapshots[0]}'::uuid else '${snapshots[1]}'::uuid end;
    insert into public.calendar_submission_occurrences(id,submission_id,occurrence_id,logical_occurrence_id,local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
      select snapshot_id,submission_id,o.id,o.logical_occurrence_id,o.local_start,o.local_end,o.timezone,o.all_day,o.start_at,o.end_at,o.occupancy_start,o.occupancy_end from public.calendar_event_occurrences o where o.id=occurrence_id;
    if '${scenario}'='resource' then insert into public.calendar_submission_resource_requests values(snapshot_id,'${resource}','template',1,null); end if;
    if '${scenario}'='room' then insert into public.calendar_submission_room_requests values(snapshot_id,'${room}','template'); end if;
  end loop;
end $fixture$;
`);
const eventQuery = id => `(select s.event_id from public.calendar_submission_occurrences o join public.calendar_event_submissions s on s.id=o.submission_id where o.id='${id}')`;
const firstEvent = eventQuery(snapshots[0]);
const secondEvent = eventQuery(snapshots[1]);
const claims = `select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);`;
await sql(`begin; ${claims} do $decisions$ declare c record; winner uuid := ${firstEvent}; begin
  for c in select * from private.calendar_current_conflicts() loop
    if c.classification='hard' then raise exception 'Fixture has unexpected hard conflict'; end if;
    perform public.calendar_record_conflict_decision(c.fingerprint,case when c.classification='planning' then 'advance' else 'acknowledge' end,
      'Race decision',case when c.classification='planning' then winner else null end);
  end loop; end $decisions$; commit;`);
const first = psql([], `begin isolation level ${isolation}; ${claims} select private.calendar_approve_initial(${firstEvent},1,'Race','Planner','+15125550123'); select pg_sleep(8); commit;`, "phase6_race_a");
let sleeping = false;
for (let i = 0; i < 60; i++) {
  if (await sql("select count(*) from pg_stat_activity where application_name='phase6_race_a' and wait_event='PgSleep';") === "1") { sleeping = true; break; }
  await sleep(100);
}
if (!sleeping) throw new Error(`First transaction did not reach its lock barrier: ${JSON.stringify(await first)}`);
const second = psql([], `begin isolation level ${isolation}; ${claims} select count(*) from public.calendar_event_commitments; select private.calendar_approve_initial(${secondEvent},1,'Race','Planner','+15125550123'); commit;`, "phase6_race_b");
let blocked = false;
for (let i = 0; i < 50; i++) {
  if (await sql("select count(*) from pg_stat_activity where application_name='phase6_race_b' and wait_event_type='Lock';") === "1") { blocked = true; break; }
  await sleep(100);
}
const [a,b] = await Promise.all([first,second]);
if (!blocked || a.code !== 0 || b.code === 0 || !/blocks first|exclusive on-site|could not serialize access|conflict decisions/i.test(b.stderr)) {
  throw new Error(`Concurrent approval check failed: ${JSON.stringify({ blocked,a,b })}`);
}
if (await sql("select count(*) from public.calendar_event_commitments where state='active';") !== "1") throw new Error("Expected exactly one active approved event.");
if (scenario === "room" && await sql("select count(*) from public.reservations where status='approved' and calendar_commitment_id is not null;") !== "1") throw new Error("Expected exactly one active room hold.");
if (scenario === "resource" && await sql("select count(*) from public.calendar_resource_allocations where status='confirmed';") !== "1") throw new Error("Expected exactly one confirmed allocation.");
console.log(`Real PostgreSQL ${isolation} ${scenario} approval race passed.`);
