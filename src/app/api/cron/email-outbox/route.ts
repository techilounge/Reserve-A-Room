import { isCronAuthorized } from "@/lib/cron/auth";
import { deliverQueuedEmails } from "@/lib/email/outbox";
import { deliverQueuedSystemEmails } from "@/lib/email/system-outbox";
import { getServerEnv } from "@/lib/env/server";

/**
 * Safety-net sweep for the email outbox. Emails are normally sent right after the action
 * that queued them; this picks up anything left behind. Vercel Cron calls it (vercel.json)
 * with `Authorization: Bearer $CRON_SECRET`.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = getServerEnv().CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const [reservations, system] = await Promise.all([
      deliverQueuedEmails({ limit: 6, concurrency: 2 }),
      deliverQueuedSystemEmails({ limit: 6, concurrency: 2 }),
    ]);
    const summary = {
      ok: true,
      durationMs: Date.now() - startedAt,
      reservations,
      system,
      moreMayRemain: reservations.claimed === 6 || system.claimed === 6,
    };
    console.info("[cron] email outbox sweep complete", summary);
    return Response.json(summary);
  } catch (error) {
    console.error("[cron] email outbox sweep failed", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown cron error",
    });
    return Response.json({ ok: false }, { status: 500 });
  }
}
