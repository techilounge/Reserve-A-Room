import { describe, expect, it } from "vitest";

import { emailProviderIdempotencyKey } from "./idempotency";

describe("emailProviderIdempotencyKey", () => {
  it("is stable when the same outbox row is reclaimed", () => {
    const id = "ff99b96a-19cd-4bf5-a4d8-47b544ad2811";
    const keysAcrossClaims = [1, 2, 3, 4, 5].map(() => emailProviderIdempotencyKey("reservation", id));

    expect(new Set(keysAcrossClaims)).toEqual(new Set(["reserve-a-room/reservation-email/v1/ff99b96a-19cd-4bf5-a4d8-47b544ad2811"]));
  });

  it("namespaces the two outboxes", () => {
    const id = "ff99b96a-19cd-4bf5-a4d8-47b544ad2811";

    expect(emailProviderIdempotencyKey("reservation", id)).not.toBe(emailProviderIdempotencyKey("system", id));
  });

  it("does not reuse a key for a different row", () => {
    expect(emailProviderIdempotencyKey("system", "row-a")).not.toBe(
      emailProviderIdempotencyKey("system", "row-b"),
    );
  });
});
