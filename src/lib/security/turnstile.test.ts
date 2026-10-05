import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const HOSTNAME = "reservearoom.example.org";

async function load(env: { site?: string; secret?: string }) {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", env.site ?? "");
  vi.stubEnv("TURNSTILE_SECRET_KEY", env.secret ?? "");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", `https://${HOSTNAME}`);
  vi.stubEnv("VERCEL_ENV", "");
  return import("./turnstile");
}

const fetchMock = vi.fn();
const cloudflare = (result: Record<string, unknown>) => fetchMock.mockResolvedValueOnce({ json: async () => result });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Turnstile verification", () => {
  it("is off unless both keys are set, and then never blocks or calls Cloudflare", async () => {
    for (const env of [{}, { site: "site" }, { secret: "secret" }]) {
      const { isTurnstileEnabled, verifyTurnstile } = await load(env);
      expect(isTurnstileEnabled()).toBe(false);
      expect(await verifyTurnstile(undefined, "1.2.3.4")).toBe(true);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing token without calling Cloudflare", async () => {
    const { verifyTurnstile } = await load({ site: "site", secret: "secret" });
    expect(await verifyTurnstile(undefined, "1.2.3.4")).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sends the secret, token and IP to Cloudflare and accepts a matching success", async () => {
    const { verifyTurnstile } = await load({ site: "site", secret: "secret" });
    cloudflare({ success: true, action: "reserve", hostname: HOSTNAME });
    expect(await verifyTurnstile("good-token", "1.2.3.4")).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect(Object.fromEntries(new URLSearchParams(String(init.body)))).toEqual({
      secret: "secret",
      response: "good-token",
      remoteip: "1.2.3.4",
    });
  });

  it("trusts only an explicit success for this site", async () => {
    const { verifyTurnstile } = await load({ site: "site", secret: "secret" });
    cloudflare({ success: false, "error-codes": ["invalid-input-response"] });
    expect(await verifyTurnstile("bad-token", "1.2.3.4")).toBe(false);
    cloudflare({});
    expect(await verifyTurnstile("odd-token", "1.2.3.4")).toBe(false);
    // A token minted for another website is refused.
    cloudflare({ success: true, action: "reserve", hostname: "evil.example.com" });
    expect(await verifyTurnstile("elsewhere", "1.2.3.4")).toBe(false);
  });

  it("binds a token to the form that minted it", async () => {
    const { verifyTurnstile } = await load({ site: "site", secret: "secret" });
    const { TURNSTILE_ACTIONS } = await import("./turnstile-actions");
    // The reservation form's token is not accepted by the recurring request, and vice versa.
    cloudflare({ success: true, action: TURNSTILE_ACTIONS.reserve, hostname: HOSTNAME });
    expect(await verifyTurnstile("t1", "1.2.3.4", TURNSTILE_ACTIONS.recurringRequest)).toBe(false);
    cloudflare({ success: true, action: TURNSTILE_ACTIONS.recurringRequest, hostname: HOSTNAME });
    expect(await verifyTurnstile("t2", "1.2.3.4")).toBe(false);
    cloudflare({ success: true, action: TURNSTILE_ACTIONS.recurringRequest, hostname: HOSTNAME });
    expect(await verifyTurnstile("t3", "1.2.3.4", TURNSTILE_ACTIONS.recurringRequest)).toBe(true);
  });

  it("fails closed when Cloudflare can't be reached", async () => {
    const { verifyTurnstile } = await load({ site: "site", secret: "secret" });
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    expect(await verifyTurnstile("token", "1.2.3.4")).toBe(false);
  });
});
