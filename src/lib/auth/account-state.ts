export type AccountStateResult =
  | { ok: true }
  | { ok: false; partial: boolean; message: string };

type Operation = () => Promise<{ error: { message: string } | null }>;

async function runOperation(operation: Operation): Promise<boolean> {
  try {
    return !(await operation()).error;
  } catch {
    return false;
  }
}

/**
 * Keep the profile authorization flag and Supabase Auth ban in a deliberate
 * order. The profile remains the request-time authorization boundary; the Auth
 * ban prevents a disabled user from signing in or refreshing a session.
 */
export async function synchronizeAccountState(options: {
  active: boolean;
  profileAlreadyActive: boolean;
  updateAuth: Operation;
  updateProfile: Operation;
}): Promise<AccountStateResult> {
  const { active, profileAlreadyActive, updateAuth, updateProfile } = options;

  if (active) {
    if (!(await runOperation(updateAuth))) {
      return { ok: false, partial: false, message: "The sign-in account couldn't be re-enabled." };
    }
    if (!profileAlreadyActive) {
      if (!(await runOperation(updateProfile))) {
        return {
          ok: false,
          partial: true,
          message: "Sign-in was restored, but application access is still disabled. Please retry.",
        };
      }
    }
    return { ok: true };
  }

  // Always re-run the authoritative RPC, even for a disabled profile: it also
  // checks the current role and must reject disabling a protected Super Admin.
  if (!(await runOperation(updateProfile))) {
    return { ok: false, partial: false, message: "Application access couldn't be disabled." };
  }
  if (!(await runOperation(updateAuth))) {
    return {
      ok: false,
      partial: true,
      message: "Application access is disabled, but the sign-in ban couldn't be confirmed. Use ‘Confirm sign-in blocked’ to retry.",
    };
  }
  return { ok: true };
}
