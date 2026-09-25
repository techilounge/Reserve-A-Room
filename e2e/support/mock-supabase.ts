/**
 * TEST-ONLY stand-in for the Supabase services the app calls, used by the Playwright suite
 * (`npm run test:e2e`) and for manual QA without Docker. NEVER deploy or point a real
 * deployment at it: it signs JWTs with a fixed secret and has fixed test passwords.
 *
 * - Data: the real migrations running in PGlite (Postgres compiled to WASM) — the same
 *   engine as the DB tests — so RLS, triggers, RPCs and constraints behave for real.
 * - REST: the handful of PostgREST routes the app uses (catalog tables + every RPC,
 *   executed as the role derived from the bearer token).
 * - Auth: a minimal GoTrue — password sign-in, refresh, user, invite, admin users.
 * - Helpers: GET /health, and GET /qa/cookie?email= which returns a ready-made
 *   @supabase/ssr session cookie value for a test account.
 *
 * Run: node e2e/support/mock-supabase.ts   (port: MOCK_SUPABASE_PORT, default 54400)
 */
import { createHmac, randomUUID } from "node:crypto";
import http from "node:http";

import { createRoom, createTestDb, insertReservation, localTime, roomId } from "../../supabase/tests/support/db.ts";

import { TEST_ACCOUNTS, TEST_JWT_SECRET, TEST_PASSWORD, TEST_SERVICE_KEY } from "./accounts.ts";

const PORT = Number(process.env.MOCK_SUPABASE_PORT ?? 54400);

const db = await createTestDb();
// Stable ids so the app's catalog cache survives mock restarts.
await db.query("update public.rooms set id = '00000000-0000-4000-8000-000000000001' where slug = 'conference-room'");
await db.query("update public.ministries set id = ('00000000-0000-4000-8000-1' || lpad(sort_order::text, 11, '0'))::uuid");

// Sample rooms exercising different configurations.
let hall = await createRoom(db, { slug: "fellowship-hall", capacity: 120, approval_required: true, max_advance_value: 8, max_advance_unit: "week", food_drinks_allowed: true });
await db.query("update public.rooms set name='Fellowship Hall', description='Large hall for fellowship meals, programs and events.', location='Main building, lower level', sort_order=20, id='00000000-0000-4000-8000-000000000002' where id=$1", [hall]);
hall = '00000000-0000-4000-8000-000000000002';
const classroom = await createRoom(db, { slug: "classroom-a", capacity: 25, approval_required: true, max_advance_value: 6, max_advance_unit: "week", food_drinks_allowed: true });
await db.query("update public.rooms set id='00000000-0000-4000-8000-000000000003', name='Classroom A', description='Classroom for Bible study, training and small classes.', sort_order=30, reservable=false, unavailable_message='Closed for carpet cleaning this week.' where id=$1", [classroom]);
const conf = await roomId(db, "conference-room");
await db.query(`insert into public.room_amenities (room_id, amenity_id) select $1, id from public.amenities where name in ('TV / Display','Whiteboard','Tables','Chairs','Wi-Fi')`, [conf]);
await db.query(`insert into public.room_amenities (room_id, amenity_id) select $1, id from public.amenities where name in ('Sound System','Kitchen Access','Tables','Chairs','Piano','Projector')`, [hall]);

for (const [room, day, from, to, status] of [
  [conf, 0, "18:00", "19:30", "approved"], [conf, 1, "09:00", "10:30", "approved"], [conf, 1, "13:00", "14:00", "pending"],
  [hall, 1, "10:00", "12:00", "pending"], [hall, 2, "17:00", "21:00", "approved"],
] as const) {
  try {
    await insertReservation(db, { roomId: room, startAt: await localTime(db, day, from), endAt: await localTime(db, day, to), status });
  } catch (e) { console.warn("skip fixture", day, from, (e as Error).message); }
}

// ---- Minimal GoTrue: fixed staff accounts, HS256 JWTs ------------------------
const JWT_SECRET = TEST_JWT_SECRET;
const PASSWORD = TEST_PASSWORD;
const staff = new Map<string, { id: string; email: string }>();
for (const { id, email, role, name } of Object.values(TEST_ACCOUNTS)) {
  const { rows: [u] } = await db.query<{ id: string }>("insert into auth.users (id, email) values ($1, $2) returning id", [id, email]);
  await db.query("insert into public.profiles (id, email, full_name, role) values ($1, $2, $3, $4)", [u.id, email, name, role]);
  staff.set(email, { id: u.id, email });
}
await db.query(`insert into public.notifications (user_id, type, title, message, reservation_id, created_at)
  select p.id, 'reservation_pending', 'New request: ' || rm.name, r.requester_first_name || ' ' || r.requester_last_name || ' requested ' || rm.name || '.', r.id, now() - interval '25 minutes'
  from public.reservations r join public.rooms rm on rm.id = r.room_id cross join public.profiles p where r.status = 'pending'`);
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
function sign(user: { id: string; email: string }) {
  const now = Math.floor(Date.now() / 1000);
  const body = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: user.id, email: user.email, role: "authenticated", aud: "authenticated", iat: now, exp: now + 3600, session_id: randomUUID() })}`;
  return `${body}.${createHmac("sha256", JWT_SECRET).update(body).digest("base64url")}`;
}
function verify(token: string | undefined): { sub: string; email: string } | null {
  if (!token) return null;
  const [h, p, s] = token.split(".");
  if (!s || createHmac("sha256", JWT_SECRET).update(`${h}.${p}`).digest("base64url") !== s) return null;
  const claims = JSON.parse(Buffer.from(p, "base64url").toString());
  return claims.exp > Date.now() / 1000 ? claims : null;
}
const refreshTokens = new Map<string, { id: string; email: string }>();
function session(user: { id: string; email: string }) {
  const refresh = randomUUID();
  refreshTokens.set(refresh, user);
  return {
    access_token: sign(user), token_type: "bearer", expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: refresh, user: userJson(user),
  };
}
function userJson(user: { id: string; email: string }) {
  return { id: user.id, aud: "authenticated", role: "authenticated", email: user.email, app_metadata: { provider: "email" }, user_metadata: {}, created_at: new Date().toISOString() };
}
function roleFor(req: http.IncomingMessage): { role: "anon" | "authenticated" | "service_role"; sub?: string } {
  const bearer = (req.headers.authorization ?? "").replace(/^Bearer /, "");
  if (bearer === TEST_SERVICE_KEY) return { role: "service_role" };
  const claims = verify(bearer);
  return claims ? { role: "authenticated", sub: claims.sub } : { role: "anon" };
}

async function json(sql: string, params: unknown[] = []) {
  const { rows } = await db.query<{ j: unknown }>(sql, params);
  return rows[0]?.j ?? null;
}

async function jsonAs(req: http.IncomingMessage, sql: string, params: unknown[] = []) {
  const who = roleFor(req);
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${who.role}`);
    await tx.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify(who.sub ? { sub: who.sub, role: who.role } : { role: who.role })]);
    const { rows } = await tx.query<{ j: unknown }>(sql, params);
    return rows[0]?.j ?? null;
  });
}

async function readBody(req: http.IncomingMessage) {
  let body = "";
  for await (const chunk of req) body += chunk;
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  try {
    if (url.pathname === "/health") return send(200, { ok: true });
    // --- Test helper: a ready-made @supabase/ssr session cookie for a test account ---
    if (url.pathname === "/qa/cookie") {
      const user = staff.get(url.searchParams.get("email") ?? "");
      res.writeHead(user ? 200 : 404, { "content-type": "text/plain", "access-control-allow-origin": "*" });
      return res.end(user ? `base64-${Buffer.from(JSON.stringify(session(user))).toString("base64url")}` : "");
    }
    // --- auth ---
    if (url.pathname === "/auth/v1/token" && req.method === "POST") {
      const body = await readBody(req);
      if (url.searchParams.get("grant_type") === "password") {
        const user = staff.get(String(body.email).toLowerCase());
        if (!user || body.password !== PASSWORD) return send(400, { code: "invalid_credentials", error_code: "invalid_credentials", msg: "Invalid login credentials" });
        return send(200, session(user));
      }
      const user = refreshTokens.get(body.refresh_token);
      return user ? send(200, session(user)) : send(400, { error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" });
    }
    if (url.pathname === "/auth/v1/verify" && req.method === "POST") {
      const body = await readBody(req);
      const user = staff.get(TEST_ACCOUNTS.superAdmin.email);
      if (!user || body.token_hash !== "e2e-password-setup-token" || !["invite", "recovery"].includes(body.type)) {
        return send(403, { code: 403, error_code: "otp_expired", msg: "Token has expired or is invalid" });
      }
      return send(200, session(user));
    }
    if (url.pathname === "/auth/v1/user") {
      const claims = verify((req.headers.authorization ?? "").replace(/^Bearer /, ""));
      if (!claims) return send(401, { code: 401, error_code: "bad_jwt", msg: "invalid JWT" });
      if (req.method === "PUT") await readBody(req);
      return send(200, userJson({ id: claims.sub, email: claims.email }));
    }
    if (url.pathname === "/auth/v1/invite" && req.method === "POST") {
      const body = await readBody(req);
      const email = String(body.email).toLowerCase();
      const exists = await db.query("select 1 from auth.users where lower(email) = $1", [email]);
      if (exists.rows.length) return send(422, { code: 422, error_code: "email_exists", msg: "A user with this email address has already been registered" });
      const { rows: [u] } = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
      return send(200, userJson({ id: u.id, email }));
    }
    if (url.pathname === "/auth/v1/admin/users" && req.method === "GET") {
      const { rows } = await db.query<{ id: string; email: string }>("select id, email from auth.users");
      return send(200, { users: rows.map(userJson), aud: "authenticated" });
    }
    if (url.pathname.startsWith("/auth/v1/admin/users/") && req.method === "PUT") {
      await readBody(req);
      const id = url.pathname.split("/").pop()!;
      return send(200, userJson({ id, email: "x@example.org" }));
    }
    if (url.pathname === "/auth/v1/logout") { res.writeHead(204); return res.end(); }
    if (url.pathname === "/auth/v1/recover") { await readBody(req); return send(200, {}); }

    if (req.method === "GET" && url.pathname === "/rest/v1/app_settings") {
      return send(200, await json("select to_jsonb(s) - 'extra_admin_notification_emails' as j from public.app_settings s"));
    }
    if (req.method === "GET" && url.pathname === "/rest/v1/rooms") {
      return send(200, await json(`select coalesce(jsonb_agg(to_jsonb(r) || jsonb_build_object('room_amenities',
          (select coalesce(jsonb_agg(jsonb_build_object('amenities', to_jsonb(a))), '[]') from public.room_amenities ra join public.amenities a on a.id = ra.amenity_id where ra.room_id = r.id))
          order by r.sort_order, r.name), '[]') as j from public.rooms r where r.active`));
    }
    if (req.method === "GET" && url.pathname === "/rest/v1/ministries") {
      return send(200, await json("select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by sort_order, name), '[]') as j from public.ministries where active"));
    }
    const rpc = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_]+)$/);
    if (req.method === "POST" && rpc) {
      let body = "";
      for await (const chunk of req) body += chunk;
      const args = JSON.parse(body || "{}") as Record<string, unknown>;
      const names = Object.keys(args);
      const argList = names.map((n, i) => `${n} => $${i + 1}`).join(", ");
      // PostgREST accepts bytea as "\x…" hex text; PGlite wants bytes.
      const values = names.map((n) => {
        const v = args[n];
        if (Array.isArray(v)) return `{${v.map((x) => `"${String(x).replace(/"/g, '\\"')}"`).join(",")}}`;
        return typeof v === "string" && /^\\x[0-9a-f]*$/i.test(v) ? Buffer.from(v.slice(2), "hex") : v;
      });
      const { rows: [meta] } = await db.query<{ set: boolean; typtype: string; rt: string }>(
        "select p.proretset as set, t.typtype, format_type(p.prorettype, null) as rt from pg_proc p join pg_type t on t.oid = p.prorettype where p.proname = $1 and p.pronamespace = 'public'::regnamespace",
        [rpc[1]],
      );
      const tabular = meta.set || meta.typtype === "c" || meta.rt === "record";
      if (!tabular) return send(200, await jsonAs(req, `select to_jsonb(public.${rpc[1]}(${argList})) as j`, values));
      const rows = (await jsonAs(req, `select coalesce(jsonb_agg(to_jsonb(t)), '[]') as j from public.${rpc[1]}(${argList}) t`, values)) as unknown[];
      // A non-SETOF composite result is a single JSON object in PostgREST.
      if (!meta.set) return send(200, rows[0] ?? null);
      if ((req.headers.accept ?? "").includes("vnd.pgrst.object")) {
        return rows.length ? send(200, rows[0]) : send(406, { code: "PGRST116", message: "no rows" });
      }
      return send(200, rows);
    }
    console.warn("unhandled", req.method, url.pathname + url.search);
    send(404, { message: "not mocked" });
  } catch (error) {
    // Expected in tests (conflicts, permission checks): one line, not a stack trace.
    const { code } = error as { code?: string };
    console.error(`[mock] ${req.method} ${url.pathname} → ${code ?? "error"}: ${(error as Error).message}`);
    send(400, { code: (error as { code?: string }).code, message: (error as Error).message });
  }
});
server.listen(PORT, "127.0.0.1", () => console.log(`Mock Supabase (test only) on http://localhost:${PORT}`));
