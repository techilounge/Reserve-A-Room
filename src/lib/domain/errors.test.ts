import { describe, expect, it } from "vitest";

import { AppError, toAppError } from "./errors";

describe("toAppError", () => {
  it("maps the exclusion-constraint violation to the friendly conflict message", () => {
    const error = toAppError({ code: "23P01", message: 'conflicting key value violates exclusion constraint "reservations_no_overlap"' });
    expect(error.kind).toBe("conflict");
    expect(error.message).toBe(
      "That room was just reserved or requested by someone else for this time. Please select another time or room.",
    );
    expect(error.message).not.toMatch(/constraint|23P01|reservations_no_overlap/);
  });

  it("includes the room's rule in advance-booking messages", () => {
    expect(toAppError({ code: "RAR02" }, { advanceLimitLabel: "4 weeks" }).message).toBe(
      "This room may only be reserved up to 4 weeks in advance.",
    );
  });

  it.each([
    ["RAR01", "room_unavailable"],
    ["RAR03", "too_soon"],
    ["RAR04", "invalid_time"],
    ["RAR05", "invalid_transition"],
    ["RAR06", "last_super_admin"],
    ["RAR07", "rate_limited"],
    ["RAR08", "not_found"],
    ["RAR09", "forbidden"],
    ["RAR11", "protected_super_admin"],
    ["42501", "forbidden"],
    ["PGRST202", "database_update_required"],
  ])("maps %s to %s", (code, kind) => {
    expect(toAppError({ code }).kind).toBe(kind);
  });

  it("never leaks unknown internal errors", () => {
    const error = toAppError(new Error('relation "public.secret" does not exist'));
    expect(error.kind).toBe("unexpected");
    expect(error.message).not.toContain("relation");
    expect(toAppError(undefined).kind).toBe("unexpected");
    expect(toAppError("boom").kind).toBe("unexpected");
  });

  it("passes AppErrors through unchanged", () => {
    const original = new AppError("validation", "Check the form");
    expect(toAppError(original)).toBe(original);
  });
});
