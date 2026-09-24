import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { asRole, createRoom, createStaff, createTestDb, insertReservation, localTime } from "./support/db";

let db: PGlite;
let admin: string;
let reservationId: string;

beforeAll(async () => {
  db = await createTestDb();
  admin = await createStaff(db, "admin");
  const room = await createRoom(db);
  ({ id: reservationId } = await insertReservation(db, { roomId: room, startAt: await localTime(db, 3, "09:00"), endAt: await localTime(db, 3, "10:00") }));
  await db.query(
    `insert into public.email_logs (reservation_id, recipient, event_type) values
      ($1, 'guest@example.org', 'request_submitted'), ($1, 'office@example.org', 'admin_new_request')`,
    [reservationId],
  );
});

const service = <T>(sql: string, params: unknown[] = []) =>
  asRole(db, "service_role", async (tx) => (await tx.query<T>(sql, params)).rows);

describe("email outbox", () => {
  it("claims queued emails exactly once", async () => {
    const first = await service<{ claim_emails: string }>("select public.claim_emails(10)");
    const second = await service<{ claim_emails: string }>("select public.claim_emails(10)");
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(0);
    const { rows } = await db.query("select distinct status, attempt_count from public.email_logs");
    expect(rows).toEqual([{ status: "sending", attempt_count: 1 }]);
  });

  it("provides the template context, including the link seed, to the service role only", async () => {
    const [{ id }] = (await db.query<{ id: string }>("select id from public.email_logs where event_type = 'request_submitted'")).rows;
    const [ctx] = await service<Record<string, unknown>>("select * from public.email_context($1)", [id]);
    expect(ctx).toMatchObject({ recipient: "guest@example.org", event_type: "request_submitted", timezone: "America/Chicago" });
    expect(String(ctx.guest_token_seed)).toMatch(/^\\x[0-9a-f]{32}$/);
    await expect(asRole(db, "authenticated", (tx) => tx.query("select * from public.email_context($1)", [id]), admin)).rejects.toMatchObject({ code: "42501" });
  });

  it("records failures, alerts staff, and lets staff retry", async () => {
    const [{ id }] = (await db.query<{ id: string }>("select id from public.email_logs where event_type = 'request_submitted'")).rows;
    await service("select public.complete_email($1, 'failed', null, $2)", [id, "Domain not verified"]);
    const { rows } = await db.query("select status, error_message from public.email_logs where id = $1", [id]);
    expect(rows[0]).toEqual({ status: "failed", error_message: "Domain not verified" });
    const alerts = await db.query("select type from public.notifications where reservation_id = $1", [reservationId]);
    expect(alerts.rows).toEqual([{ type: "email_failed" }]);

    await asRole(db, "authenticated", (tx) => tx.query("select public.retry_email($1)", [id]), admin);
    const retried = await db.query("select status, attempt_count, error_message from public.email_logs where id = $1", [id]);
    expect(retried.rows[0]).toEqual({ status: "queued", attempt_count: 0, error_message: null });
    await expect(asRole(db, "authenticated", (tx) => tx.query("select public.retry_email($1)", [id]), admin)).rejects.toMatchObject({ code: "RAR05" });
  });

  it("marks sent emails with the provider id", async () => {
    const [{ id }] = (await db.query<{ id: string }>("select id from public.email_logs where event_type = 'admin_new_request'")).rows;
    await service("select public.complete_email($1, 'sent', 're_123')", [id]);
    const { rows } = await db.query<{ status: string; provider_message_id: string; sent: boolean }>(
      "select status, provider_message_id, sent_at is not null as sent from public.email_logs where id = $1",
      [id],
    );
    expect(rows[0]).toEqual({ status: "sent", provider_message_id: "re_123", sent: true });
  });

  it("gives up after five attempts", async () => {
    await db.query("insert into public.email_logs (reservation_id, recipient, event_type, attempt_count) values ($1, 'x@example.org', 'reservation_confirmed', 5)", [reservationId]);
    const claimed = await service<{ claim_emails: string }>("select public.claim_emails(10)");
    expect(claimed).toHaveLength(1); // only the retried one from the previous test
  });
});
