import { beforeEach, describe, expect, it, vi } from "vitest";

import { addDaysToLocalDate, todayInZone } from "@/lib/datetime";

vi.mock("server-only", () => ({}));

const verifyTurnstile = vi.fn<(token: string | undefined, ip: string, action?: string) => Promise<boolean>>();
const rpc = vi.fn();
const hitRateLimit = vi.fn(async () => true);

vi.mock("@/lib/security/turnstile", () => ({
  verifyTurnstile: (...args: [string | undefined, string, string?]) => verifyTurnstile(...args),
}));
vi.mock("@/lib/security/request", () => ({ clientIp: async () => "203.0.113.9" }));
vi.mock("@/lib/security/rate-limit", () => ({
  hitRateLimit: (...args: unknown[]) => (hitRateLimit as (...a: unknown[]) => Promise<boolean>)(...args),
  RATE_LIMITS: { recurringRequestPerIp: {}, recurringRequestPerEmail: {} },
}));
vi.mock("@/lib/email/schedule", () => ({ scheduleSystemEmailDelivery: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createSupabaseServiceClient: () => ({ rpc: (...args: unknown[]) => ({ single: () => rpc(...args) }) }),
}));

const ROOM_ID = "00000000-0000-4000-8000-000000000001";
const TIME_ZONE = "America/Chicago";
vi.mock("@/lib/data/catalog", () => ({
  loadCatalog: async () => ({
    ok: true,
    catalog: {
      settings: { timeZone: "America/Chicago", dayStart: "06:00", dayEnd: "22:00", intervalMinutes: 30 },
      rooms: [{ id: "00000000-0000-4000-8000-000000000001", name: "Conference Room" }],
    },
  }),
}));

const { submitRecurringRequest } = await import("@/app/(public)/recurring-request/actions");

function form(overrides: Record<string, string> = {}, omit: string[] = []) {
  const data = new FormData();
  const fields: Record<string, string> = {
    roomId: ROOM_ID,
    preferredStartDate: addDaysToLocalDate(todayInZone(TIME_ZONE), 14),
    start: "10:00",
    end: "11:00",
    recurrenceDescription: "Every Saturday through December",
    firstName: "Jamie",
    lastName: "Rivera",
    email: "jamie@example.org",
    phone: "(512) 555-0123",
    purpose: "Weekly prayer circle",
    estimatedAttendance: "12",
    requesterNotes: "",
    legalAccepted: "on",
    startedAt: String(Date.now() - 10_000),
    website: "",
    turnstileToken: "token-from-widget",
    ...overrides,
  };
  for (const [key, value] of Object.entries(fields)) if (!omit.includes(key)) data.set(key, value);
  return data;
}

const IDLE = { status: "idle" } as const;

beforeEach(() => {
  verifyTurnstile.mockReset();
  rpc.mockReset();
  hitRateLimit.mockClear();
  rpc.mockResolvedValue({ data: { id: "req-1", reference_code: "RRR-20261004-ABCD" }, error: null });
});

describe("recurring request Turnstile verification", () => {
  it("creates the request when Cloudflare accepts the token, passing the token and client IP", async () => {
    verifyTurnstile.mockResolvedValue(true);
    const result = await submitRecurringRequest(IDLE, form());
    expect(result).toMatchObject({ status: "success", reference: "RRR-20261004-ABCD" });
    expect(verifyTurnstile).toHaveBeenCalledWith("token-from-widget", "203.0.113.9", "recurring-request");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("refuses a request whose token Cloudflare rejects, keeps the typed values, and creates nothing", async () => {
    verifyTurnstile.mockResolvedValue(false);
    const result = await submitRecurringRequest(IDLE, form({ firstName: "Taylor" }));
    expect(result.status).toBe("error");
    expect(result.message).toMatch(/verification/i);
    expect(result.values?.firstName).toBe("Taylor");
    expect(rpc).not.toHaveBeenCalled();
    expect(hitRateLimit).not.toHaveBeenCalled();
  });

  it("treats a missing or blank token as no token", async () => {
    verifyTurnstile.mockResolvedValue(false);
    await submitRecurringRequest(IDLE, form({}, ["turnstileToken"]));
    await submitRecurringRequest(IDLE, form({ turnstileToken: "" }));
    expect(verifyTurnstile.mock.calls.map(([token]) => token)).toEqual([undefined, undefined]);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("spends no Cloudflare call on bots caught by the honeypot or the minimum fill time, or on invalid forms", async () => {
    verifyTurnstile.mockResolvedValue(true);
    await submitRecurringRequest(IDLE, form({ website: "https://spam.example" }));
    await submitRecurringRequest(IDLE, form({ startedAt: String(Date.now()) }));
    await submitRecurringRequest(IDLE, form({ email: "not-an-email" }));
    expect(verifyTurnstile).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
});
