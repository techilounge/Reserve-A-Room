import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import { PGlite, type Transaction } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const SUPABASE_DIR = path.resolve(import.meta.dirname, "..", "..");
const MIGRATIONS_DIR = path.join(SUPABASE_DIR, "migrations");

export const CHURCH_TZ = "America/Chicago";

export type Queryable = Pick<PGlite, "query" | "exec"> | Transaction;

/** Fresh database with the Supabase stub and every migration applied, in order. */
export async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create({ extensions: { btree_gist, pg_trgm } });
  await db.exec(readFileSync(path.join(import.meta.dirname, "supabase-stub.sql"), "utf8"));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    try {
      await db.exec(readFileSync(path.join(MIGRATIONS_DIR, file), "utf8"));
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${(error as Error).message}`);
    }
  }
  return db;
}

export type Role = "anon" | "authenticated" | "service_role";

/**
 * Runs `fn` inside a transaction as an API role, exactly like PostgREST does:
 * SET LOCAL ROLE + request.jwt.claims. Commits unless `fn` throws.
 */
export async function asRole<T>(
  db: PGlite,
  role: Role,
  fn: (tx: Transaction) => Promise<T>,
  userId?: string,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    const claims = JSON.stringify(userId ? { sub: userId, role } : { role });
    await tx.query("select set_config('request.jwt.claims', $1, true)", [claims]);
    return fn(tx);
  });
}

export async function createStaff(
  db: PGlite,
  role: "admin" | "super_admin",
  options: { active?: boolean; email?: string } = {},
): Promise<string> {
  const email = options.email ?? `${role}-${crypto.randomUUID().slice(0, 8)}@example.org`;
  const {
    rows: [user],
  } = await db.query<{ id: string }>("insert into auth.users (email) values ($1) returning id", [email]);
  await db.query(
    "insert into public.profiles (id, email, full_name, role, active) values ($1, $2, $3, $4, $5)",
    [user.id, email, `Test ${role}`, role, options.active ?? true],
  );
  return user.id;
}

/** A timestamptz for local church time `daysAhead` days from today at HH:MM. */
export async function localTime(db: Queryable, daysAhead: number, hhmm: string): Promise<string> {
  const { rows } = await db.query<{ t: string }>(
    `select ((((now() at time zone $3)::date + $1::int) + $2::time) at time zone $3)::text as t`,
    [daysAhead, hhmm, CHURCH_TZ],
  );
  return rows[0].t;
}

export async function roomId(db: Queryable, slug: string): Promise<string> {
  const { rows } = await db.query<{ id: string }>("select id from public.rooms where slug = $1", [slug]);
  if (!rows[0]) throw new Error(`No room ${slug}`);
  return rows[0].id;
}

export async function createRoom(
  db: Queryable,
  overrides: Partial<{
    slug: string;
    capacity: number;
    approval_required: boolean;
    max_advance_value: number | null;
    max_advance_unit: "day" | "week" | "month" | null;
    food_drinks_allowed: boolean;
    active: boolean;
    reservable: boolean;
  }> = {},
): Promise<string> {
  const slug = overrides.slug ?? `test-room-${crypto.randomUUID().slice(0, 8)}`;
  const { rows } = await db.query<{ id: string }>(
    `insert into public.rooms (name, slug, capacity, approval_required, max_advance_value, max_advance_unit,
       food_drinks_allowed, active, reservable)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
    [
      `Room ${slug}`,
      slug,
      overrides.capacity ?? 20,
      overrides.approval_required ?? true,
      overrides.max_advance_value === undefined ? null : overrides.max_advance_value,
      overrides.max_advance_unit === undefined ? null : overrides.max_advance_unit,
      overrides.food_drinks_allowed ?? true,
      overrides.active ?? true,
      overrides.reservable ?? true,
    ],
  );
  return rows[0].id;
}

export type ReservationInput = {
  roomId: string;
  startAt: string;
  endAt: string;
  status?: "pending" | "approved";
};

/** Inserts a reservation directly (as the table owner — triggers and constraints apply). */
export async function insertReservation(db: Queryable, input: ReservationInput): Promise<{ id: string; reference_code: string }> {
  const { rows } = await db.query<{ id: string; reference_code: string }>(
    `insert into public.reservations (
       reference_code, status, room_id, start_at, end_at,
       requester_first_name, requester_last_name, requester_email, requester_phone,
       other_ministry_name, purpose, estimated_attendance,
       approval_required_at_submission, food_drinks_allowed_at_submission, room_capacity_at_submission,
       guest_token_hash, guest_token_seed)
     values (private.generate_reference_code(), $1, $2, $3, $4,
       'Test', 'Guest', 'guest@example.org', '+15125550123',
       'Test Group', 'Planning meeting', 10,
       false, false, 0,
       sha256(convert_to(gen_random_uuid()::text, 'UTF8')), uuid_send(gen_random_uuid()))
     returning id, reference_code`,
    [input.status ?? "pending", input.roomId, input.startAt, input.endAt],
  );
  return rows[0];
}
