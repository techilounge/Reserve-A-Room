import { describe, expect, it } from "vitest";

import { normalizeReference, REFERENCE_PATTERN } from "./reference-code";

describe("normalizeReference", () => {
  it("accepts canonical and loosely typed codes", () => {
    expect(normalizeReference("RAR-20261001-A7F4")).toBe("RAR-20261001-A7F4");
    expect(normalizeReference(" rar-20261001-a7f4 ")).toBe("RAR-20261001-A7F4");
    expect(normalizeReference("RAR 20261001 A7F4")).toBe("RAR-20261001-A7F4");
  });

  it("maps look-alike characters", () => {
    expect(normalizeReference("RAR-20261001-AO1L")).toBe("RAR-20261001-A011");
  });

  it("rejects anything else", () => {
    expect(normalizeReference("RAR-2026101-A7F4")).toBeNull();
    expect(normalizeReference("RAR-20261001-A7F")).toBeNull();
    expect(normalizeReference("RAR-20261001-A7FU")).toBeNull();
    expect(normalizeReference("'; drop table reservations; --")).toBeNull();
  });

  it("matches the database format", () => {
    expect(REFERENCE_PATTERN.test("RAR-20261001-Z9Z9")).toBe(true);
    expect(REFERENCE_PATTERN.test("RAR-20261001-I000")).toBe(false);
  });
});
