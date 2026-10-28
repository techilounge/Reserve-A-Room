import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rpc = vi.fn();
const send = vi.fn();
vi.mock("@/lib/supabase/service", () => ({ createSupabaseServiceClient: () => ({ rpc }) }));
vi.mock("resend", () => ({ Resend: class { emails = { send }; } }));
vi.mock("@/lib/app-url", () => ({ getAppUrl: () => new URL("https://example.org") }));
vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({ RESEND_API_KEY: "test", RESEND_FROM_EMAIL: "sender@example.org" }),
  isProductionDeployment: () => true,
}));
vi.mock("./render", () => ({ renderEmail: async () => ({ subject: "Subject", html: "<p>Text</p>", text: "Text" }) }));
vi.mock("./data", () => ({ toEmailData: () => ({}) }));
vi.mock("@/emails/types", () => ({ isEmailEvent: () => true }));
vi.mock("@react-email/render", () => ({ render: async () => "Text" }));
vi.mock("@/emails/system-templates", () => ({
  isSystemEmailEvent: () => true,
  buildSystemEmail: () => ({ element: {}, subject: "Subject" }),
}));

const { deliverQueuedEmails } = await import("./outbox");
const { deliverQueuedSystemEmails } = await import("./system-outbox");

beforeEach(() => {
  rpc.mockReset();
  send.mockReset();
  send.mockResolvedValue({ data: { id: "provider-123" }, error: null });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("lost email completion", () => {
  it.each([false, true])("reuses the provider key and payload after reclaim (system=%s)", async (system) => {
    let completion = 0;
    rpc.mockImplementation(async (name: string) => {
      if (name === "claim_emails" || name === "claim_system_emails") return { data: ["row-1"], error: null };
      if (name === "email_context") return { data: [{ event_type: "request_submitted", recipient: "guest@example.org", guest_token_seed: null }], error: null };
      if (name === "system_email_context") return { data: {
        event_type: "admin_first_login", recipient: "admin@example.org", payload: {},
        settings: { app_name: "App", church_name: "Church", timezone: "America/Chicago" },
        user: { full_name: "Admin", email: "admin@example.org", role: "admin", invitation_accepted_at: "2026-01-01" },
      }, error: null };
      if (name === "prepare_email_delivery") return { data: "ready", error: null };
      if (name === "complete_email" || name === "complete_system_email") {
        completion += 1;
        return { data: null, error: completion === 1 ? { message: "temporary database error" } : null };
      }
      throw new Error(`Unexpected RPC ${name}`);
    });

    const worker = system ? deliverQueuedSystemEmails : deliverQueuedEmails;
    await worker({ limit: 1 });
    await worker({ limit: 1 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    expect(send.mock.calls[0][1].idempotencyKey).toBe(send.mock.calls[1][1].idempotencyKey);
    expect(send.mock.calls[0][1].idempotencyKey).toContain(system ? "/system-email/" : "/reservation-email/");
    expect(vi.mocked(console.error)).toHaveBeenCalledWith(
      system ? "[system-email] could not record result" : "[email] could not record result",
      expect.objectContaining({ outboxId: "row-1", providerMessageId: "provider-123" }),
    );
  });
});
