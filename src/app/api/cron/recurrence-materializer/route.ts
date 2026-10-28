import { isCronAuthorized } from "@/lib/cron/auth";
import { getServerEnv } from "@/lib/env/server";
import { materializeDueReservationSeries } from "@/lib/recurrence/materialize";

export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isCronAuthorized(request.headers.get("authorization"), getServerEnv().CRON_SECRET)) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const startedAt = Date.now();
  try {
    const series = await materializeDueReservationSeries(10);
    const summary = {
      ok: true,
      durationMs: Date.now() - startedAt,
      series,
      moreMayRemain: series.claimed === 10,
    };
    console.info("[cron] recurrence materialization complete", summary);
    return Response.json(summary);
  } catch (error) {
    console.error("[cron] recurrence materialization failed", {
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : "Unknown cron error",
    });
    return Response.json({ ok: false }, { status: 500 });
  }
}
