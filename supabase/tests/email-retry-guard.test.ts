import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createTestDb } from "./support/db";

let db: PGlite;
const HASH = "a".repeat(64);
const OTHER_HASH = "b".repeat(64);

beforeAll(async () => {
  db = await createTestDb();
});

async function prepare(id: string, system: boolean, hash = HASH) {
  return asRole(db, "service_role", async (tx) =>
    (await tx.query<{ result: string }>("select public.prepare_email_delivery($1, $2, $3) as result", [id, hash, system])).rows[0].result,
  );
}

describe("provider retry guard", () => {
  it.each([false, true])("reuses a lost-completion claim safely (system=%s)", async (system) => {
    const table = system ? "system_email_logs" : "email_logs";
    const entityId = crypto.randomUUID();
    const insert = system
      ? "insert into public.system_email_logs(recipient,event_type,entity_type,entity_id,status,attempt_count,last_attempt_at) values ('staff@example.org','test','test',$1,'sending',1,now()) returning id"
      : "insert into public.email_logs(recipient,event_type,status,attempt_count,last_attempt_at) values ('guest@example.org','request_submitted','sending',1,now()) returning id";
    const [{ id }] = (await db.query<{ id: string }>(insert, system ? [entityId] : [])).rows;
    expect(await prepare(id, system)).toBe("ready");
    // Simulate provider acceptance followed by a failed completion RPC and lease expiry.
    await db.query(`update public.${table} set last_attempt_at = now() - interval '11 minutes' where id = $1`, [id]);
    const claims = await asRole(db, "service_role", async (tx) =>
      (await tx.query<{ id: string }>(system
        ? "select public.claim_system_emails(1, $1) as id"
        : "select public.claim_emails(1) as id", system ? [entityId] : [])).rows,
    );
    expect(claims).toEqual([{ id }]);
    expect(await prepare(id, system)).toBe("ready");
    await db.query(`update public.${table} set status = 'sent' where id = $1`, [id]);
  });

  it.each([false, true])("stops changed-payload and expired retries (system=%s)", async (system) => {
    const table = system ? "system_email_logs" : "email_logs";
    const insert = system
      ? "insert into public.system_email_logs(recipient,event_type,entity_type,entity_id,status,attempt_count) values ('staff@example.org','test','test',$1,'sending',1) returning id"
      : "insert into public.email_logs(recipient,event_type,status,attempt_count) values ('guest@example.org','request_submitted','sending',1) returning id";
    for (const expired of [false, true]) {
      const [{ id }] = (await db.query<{ id: string }>(insert, system ? [crypto.randomUUID()] : [])).rows;
      expect(await prepare(id, system)).toBe("ready");
      if (expired) await db.query(`update public.${table} set provider_first_attempt_at = now() - interval '24 hours' where id = $1`, [id]);
      expect(await prepare(id, system, expired ? HASH : OTHER_HASH)).toBe("review_required");
      const [{ provider_review_required }] = (await db.query<{ provider_review_required: boolean }>(
        `select provider_review_required from public.${table} where id = $1`, [id],
      )).rows;
      expect(provider_review_required).toBe(true);
      await db.query(`update public.${table} set status = 'failed' where id = $1`, [id]);
    }
  });

  it("does not expose the guard to authenticated users", async () => {
    await expect(asRole(db, "authenticated", (tx) =>
      tx.query("select public.prepare_email_delivery($1, $2, false)", [crypto.randomUUID(), HASH]),
    )).rejects.toMatchObject({ code: "42501" });
  });
});
