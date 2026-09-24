import type { PGlite } from "@electric-sql/pglite";
import { beforeAll, describe, expect, it } from "vitest";

import { horizonDate, type AdvanceUnit } from "../../src/lib/domain/rooms/advance-booking.ts";

import { createTestDb } from "./support/db";

let db: PGlite;
beforeAll(async () => {
  db = await createTestDb();
});

// The UI (TypeScript) and the database trigger (SQL) must agree on the last bookable
// date for every rule, including month-end clamping and leap years.
const TODAYS = ["2026-01-31", "2026-02-28", "2026-03-07", "2026-10-01", "2026-10-31", "2026-12-31", "2027-12-31", "2028-02-29"];
const RULES: [number, AdvanceUnit][] = [
  [1, "day"], [30, "day"], [90, "day"], [730, "day"],
  [1, "week"], [2, "week"], [4, "week"], [6, "week"], [104, "week"],
  [1, "month"], [3, "month"], [6, "month"], [11, "month"], [24, "month"],
];

describe("advance-booking parity (TypeScript ↔ SQL)", () => {
  it("computes identical horizons for every date and rule", async () => {
    const mismatches: string[] = [];
    for (const today of TODAYS) {
      for (const [value, unit] of RULES) {
        const { rows } = await db.query<{ d: string }>("select private.add_advance($1::date, $2, $3)::text as d", [today, value, unit]);
        const ts = horizonDate(today, { value, unit });
        if (rows[0].d !== ts) mismatches.push(`${today} + ${value} ${unit}: sql=${rows[0].d} ts=${ts}`);
      }
    }
    expect(mismatches).toEqual([]);
  });
});
