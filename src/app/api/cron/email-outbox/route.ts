import { createHash, timingSafeEqual } from "node:crypto";

import { deliverQueuedEmails } from "@/lib/email/outbox";
import { getServerEnv } from "@/lib/env/server";

/**
 * Safety-net sweep for the email outbox. Emails are normally sent right after the action
 * that queued them; this picks up anything left behind. Vercel Cron calls it (vercel.json)
 * with `Authorization: Bearer $CRON_SECRET`.
 */
export const maxDuration = 60;

function authorized(header: string | null, secret: string): boolean {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(header ?? ""), digest(`Bearer ${secret}`));
}

export async function GET(request: Request) {
  const secret = getServerEnv().CRON_SECRET;
  if (!secret || !authorized(request.headers.get("authorization"), secret)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  try {
    const result = await deliverQueuedEmails({ limit: 50 });
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron] email outbox sweep failed", error);
    return Response.json({ ok: false }, { status: 500 });
  }
}
