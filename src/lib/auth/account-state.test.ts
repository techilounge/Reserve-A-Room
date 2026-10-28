import { describe, expect, it, vi } from "vitest";

import { synchronizeAccountState } from "./account-state";

const success = async () => ({ error: null });
const failure = async () => ({ error: { message: "simulated failure" } });

describe("synchronizeAccountState", () => {
  it("unbans before enabling the profile", async () => {
    const calls: string[] = [];
    const result = await synchronizeAccountState({
      active: true,
      profileAlreadyActive: false,
      updateAuth: async () => {
        calls.push("auth");
        return success();
      },
      updateProfile: async () => {
        calls.push("profile");
        return success();
      },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["auth", "profile"]);
  });

  it("leaves the disabled profile untouched when unbanning fails", async () => {
    const updateProfile = vi.fn(success);
    const result = await synchronizeAccountState({
      active: true,
      profileAlreadyActive: false,
      updateAuth: failure,
      updateProfile,
    });
    expect(result).toMatchObject({ ok: false, partial: false });
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("reports the recoverable partial state when enabling the profile fails", async () => {
    const result = await synchronizeAccountState({
      active: true,
      profileAlreadyActive: false,
      updateAuth: success,
      updateProfile: failure,
    });
    expect(result).toMatchObject({ ok: false, partial: true });
  });

  it("disables the profile before banning Auth", async () => {
    const calls: string[] = [];
    const result = await synchronizeAccountState({
      active: false,
      profileAlreadyActive: true,
      updateProfile: async () => {
        calls.push("profile");
        return success();
      },
      updateAuth: async () => {
        calls.push("auth");
        return success();
      },
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(["profile", "auth"]);
  });

  it("does not change Auth when profile disable is rejected", async () => {
    const updateAuth = vi.fn(success);
    const result = await synchronizeAccountState({
      active: false,
      profileAlreadyActive: true,
      updateProfile: failure,
      updateAuth,
    });
    expect(result).toMatchObject({ ok: false, partial: false });
    expect(updateAuth).not.toHaveBeenCalled();
  });

  it("reports the secure partial state when the Auth ban fails", async () => {
    const result = await synchronizeAccountState({
      active: false,
      profileAlreadyActive: true,
      updateProfile: success,
      updateAuth: failure,
    });
    expect(result).toMatchObject({ ok: false, partial: true });
  });

  it("reports a partial state when the Auth provider throws after disabling the profile", async () => {
    const result = await synchronizeAccountState({
      active: false,
      profileAlreadyActive: true,
      updateProfile: success,
      updateAuth: async () => { throw new Error("network unavailable"); },
    });
    expect(result).toMatchObject({ ok: false, partial: true });
  });

  it("rechecks protection when retrying a disabled profile", async () => {
    const enableProfile = vi.fn(success);
    expect(
      await synchronizeAccountState({
        active: true,
        profileAlreadyActive: true,
        updateAuth: success,
        updateProfile: enableProfile,
      }),
    ).toEqual({ ok: true });
    expect(enableProfile).not.toHaveBeenCalled();

    const disableProfile = vi.fn(success);
    expect(
      await synchronizeAccountState({
        active: false,
        profileAlreadyActive: false,
        updateAuth: success,
        updateProfile: disableProfile,
      }),
    ).toEqual({ ok: true });
    expect(disableProfile).toHaveBeenCalledOnce();

    const ban = vi.fn(success);
    expect(await synchronizeAccountState({
      active: false,
      profileAlreadyActive: false,
      updateAuth: ban,
      updateProfile: failure,
    })).toMatchObject({ ok: false, partial: false });
    expect(ban).not.toHaveBeenCalled();
  });
});
