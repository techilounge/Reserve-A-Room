import { describe, expect, it } from "vitest";

import { extractAddress, formatFrom, sanitizeDisplayName } from "./address";

describe("email addresses", () => {
  it("extracts the address from bare and named values", () => {
    expect(extractAddress("reservations@reservearoom.stonehillchurch.org")).toBe("reservations@reservearoom.stonehillchurch.org");
    expect(extractAddress("Stonehill <reservations@example.org>")).toBe("reservations@example.org");
    expect(extractAddress("not an address")).toBeNull();
    expect(extractAddress("")).toBeNull();
  });

  it("uses the settings display name", () => {
    expect(formatFrom("Stonehill Reserve-A-Room", "Old Name <a@example.org>")).toBe('"Stonehill Reserve-A-Room" <a@example.org>');
    expect(formatFrom("", "a@example.org")).toBe("a@example.org");
    expect(formatFrom("Name", "bad")).toBeNull();
  });

  it("neutralizes header injection in the display name", () => {
    expect(sanitizeDisplayName('Evil"\r\nBcc: x@y.z <a>')).toBe("Evil Bcc: x@y.z a");
  });
});
