import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { asRole, createStaff, createTestDb } from "./support/db";

it("keeps pre-existing restored submissions out of demand without changing untouched plans", async () => {
  const db = await createTestDb("20261104100000_church_calendar_resources.sql");
  try {
    const owner = await createStaff(db, "super_admin");
    const ministry = (await db.query<{ id: string }>("select id from public.ministries where active limit 1")).rows[0].id;
    const plans: string[] = [];
    for (const name of ["Restored", "Untouched"]) {
      const cycle = (await asRole(db, "authenticated", tx => tx.query<{ id: string }>(
        "select public.save_calendar_cycle(null,$1,current_date,current_date+30,now()-interval '1 day',now()+interval '1 day','') as id", [name]), owner)).rows[0].id;
      plans.push((await asRole(db, "authenticated", tx => tx.query<{ id: string }>(
        "select public.add_calendar_ministry($1,$2) as id", [cycle, ministry]), owner)).rows[0].id);
    }
    await db.query("update public.ministry_calendar_plans set submission_revision=1,submission_status='submitted',submitted_at=now()-interval '1 hour' where id=any($1::uuid[])", [plans]);
    await db.query("select private.calendar_audit($1,'calendar_plan.restored','calendar_plan',$2,'{}'::jsonb)", [owner, plans[0]]);
    await db.exec(readFileSync("supabase/migrations/20261105100000_calendar_active_plan_resource_demand.sql", "utf8"));
    const restored = await db.query<{ id: string; resource_submission_floor: number }>(
      "select id,resource_submission_floor from public.ministry_calendar_plans where id=any($1::uuid[])", [plans]);
    expect(restored.rows.find(row => row.id === plans[0])?.resource_submission_floor).toBe(1);
    expect(restored.rows.find(row => row.id === plans[1])?.resource_submission_floor).toBe(0);
  } finally {
    await db.close();
  }
});
