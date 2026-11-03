// Run only against an empty, isolated local PostgreSQL database:
// CALENDAR_TEST_PSQL=<path to psql> CALENDAR_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55439/calendar_race_test node scripts/test-calendar-resource-concurrency.mjs
import { spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const executable = process.env.CALENDAR_TEST_PSQL || "psql";
const database = process.env.CALENDAR_TEST_DATABASE_URL;
const isolation = process.env.CALENDAR_TEST_ISOLATION ?? "read committed";
if (!["read committed", "repeatable read", "serializable"].includes(isolation)) throw new Error("Unsupported test isolation level.");
if (!database) throw new Error("Set CALENDAR_TEST_DATABASE_URL to an empty local calendar_race_* database.");
const url = new URL(database);
if (url.protocol !== "postgresql:" || !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.search || url.hash || !/^\/calendar_race_[a-z0-9_]+$/.test(url.pathname)) {
  throw new Error("Refusing to run outside an explicitly named local calendar_race_* database.");
}
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function psql(args, input = "", app = "phase4_setup") {
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
async function sql(input, app) {
  const result = await psql([], input, app);
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
const snapshots = ["33333333-3333-4333-8333-333333333331", "33333333-3333-4333-8333-333333333332"];
await sql(`
insert into auth.users(id,email) values ('${actor}','race@example.org');
insert into public.profiles(id,email,full_name,role,active) values ('${actor}','race@example.org','Race Test','super_admin',true);
insert into public.calendar_resources(id,name,category,available_quantity) values ('${resource}','Race resource','equipment',1);
do $fixture$
declare i integer; cycle_id uuid; plan_id uuid; grant_id uuid; event_id uuid; submission_id uuid; occurrence_id uuid; snapshot_id uuid;
  start_at timestamptz := date_trunc('hour', now()) + interval '7 days';
begin
  for i in 1..2 loop
    insert into public.calendar_cycles(name,start_date,end_date,submission_opens_at,submission_deadline,status)
      values ('Race '||i,current_date,current_date+30,now()-interval '1 day',now()+interval '1 day','open') returning id into cycle_id;
    insert into public.ministry_calendar_plans(cycle_id,ministry_id,submission_status,submission_revision)
      select cycle_id,id,'submitted',1 from public.ministries limit 1 returning id into plan_id;
    insert into public.calendar_plan_access(plan_id,contact_name,contact_email,label,token_hash,token_seed,expires_at)
      values(plan_id,'Race','race'||i||'@example.org','additional',decode(repeat(i::text,64),'hex'),decode(repeat(i::text,32),'hex'),now()+interval '1 day') returning id into grant_id;
    insert into public.calendar_events(plan_id,title,scope,visibility,location_type,estimated_attendance,status,revision)
      values(plan_id,'Race event','ministry','internal','church',1,'submitted',1) returning id into event_id;
    insert into public.calendar_event_submissions(event_id,plan_revision,submitted_by_grant,title,category,scope,protection,visibility,
      location_type,estimated_attendance,food_drinks_planned,setup_minutes,cleanup_minutes,schedule_kind,timezone,start_date,end_date,start_time,end_time,all_day)
      values(event_id,1,grant_id,'Race event','other','ministry','normal','internal','church',1,false,0,0,'one_time','UTC',
        start_at::date,start_at::date,start_at::time,(start_at+interval '1 hour')::time,false) returning id into submission_id;
    insert into public.calendar_event_occurrences(event_id,source_key,schedule_revision,local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
      values(event_id,'single',1,start_at at time zone 'UTC',(start_at+interval '1 hour') at time zone 'UTC','UTC',false,start_at,start_at+interval '1 hour',start_at,start_at+interval '1 hour') returning id into occurrence_id;
    snapshot_id := case i when 1 then '${snapshots[0]}'::uuid else '${snapshots[1]}'::uuid end;
    insert into public.calendar_submission_occurrences(id,submission_id,occurrence_id,logical_occurrence_id,local_start,local_end,timezone,all_day,start_at,end_at,occupancy_start,occupancy_end)
      select snapshot_id,submission_id,o.id,o.logical_occurrence_id,o.local_start,o.local_end,o.timezone,o.all_day,o.start_at,o.end_at,o.occupancy_start,o.occupancy_end from public.calendar_event_occurrences o where o.id=occurrence_id;
    insert into public.calendar_submission_resource_requests values(snapshot_id,'${resource}','template',1,null);
  end loop;
end $fixture$;
`);
const claims = `select set_config('request.jwt.claims','{"sub":"${actor}","role":"authenticated"}',true);`;
const first = psql([], `begin isolation level ${isolation}; ${claims} select private.calendar_allocate_resource('${snapshots[0]}','${resource}'); select pg_sleep(8); commit;`, "phase4_race_a");
let sleeping = false;
for (let i = 0; i < 60; i++) {
  if (await sql("select count(*) from pg_stat_activity where application_name='phase4_race_a' and wait_event='PgSleep';") === "1") { sleeping = true; break; }
  await sleep(100);
}
if (!sleeping) throw new Error(`First transaction did not reach its lock-holding barrier: ${JSON.stringify(await first)}`);
const second = psql([], `begin isolation level ${isolation}; ${claims} select count(*) from public.calendar_resource_allocations; select private.calendar_allocate_resource('${snapshots[1]}','${resource}'); commit;`, "phase4_race_b");
let blocked = false;
for (let i = 0; i < 50; i++) {
  if (await sql("select count(*) from pg_stat_activity where application_name='phase4_race_b' and wait_event_type='Lock';") === "1") { blocked = true; break; }
  await sleep(100);
}
const [a, b] = await Promise.all([first, second]);
if (!blocked || a.code !== 0 || b.code === 0 || !(b.stderr.includes("Resource capacity exceeded.") || b.stderr.includes("could not serialize access"))) {
  throw new Error(`Concurrent allocation check failed: ${JSON.stringify({ blocked, a, b })}`);
}
if (await sql("select count(*) from public.calendar_resource_allocations where status='confirmed';") !== "1") throw new Error("Expected exactly one confirmed allocation.");
console.log(`Real PostgreSQL ${isolation} race passed: the second transaction blocked and the last unit was allocated exactly once.`);
