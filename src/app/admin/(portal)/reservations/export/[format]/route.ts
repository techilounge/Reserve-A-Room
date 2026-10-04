import { getStaffSession } from "@/lib/auth/session";
import { exportReservations } from "@/lib/data/admin";
import { loadCatalog } from "@/lib/data/catalog";
import { createReservationsCsv, createReservationsPdf } from "@/lib/reservations/export-formats";
import { describeExportRange, EXPORT_MAX_ROWS, ExportTooLargeError } from "@/lib/reservations/export-limits";
import { parseReservationExportFilters } from "@/lib/reservations/filters";

export const dynamic = "force-dynamic";

function filterSummary(searchParams: URLSearchParams, roomName?: string, ministryName?: string): string {
  const parts: string[] = [];
  const status = searchParams.get("status");
  if (status) parts.push(status === "upcoming" ? "Upcoming" : `Status: ${status}`);
  if (roomName) parts.push(`Room: ${roomName}`);
  if (ministryName) parts.push(`Ministry: ${ministryName}`);
  const approval = searchParams.get("approval");
  if (approval) parts.push(approval === "required" ? "Approval required" : "Instant rooms");
  const search = searchParams.get("q")?.trim();
  if (search) parts.push(`Search: ${search.slice(0, 60)}`);
  return parts.length ? parts.join("; ") : "All statuses, rooms, and ministries";
}

export async function GET(request: Request, { params }: { params: Promise<{ format: string }> }) {
  const session = await getStaffSession();
  if (session.status !== "staff") return Response.json({ error: "Staff access required." }, { status: 401 });

  const { format } = await params;
  if (format !== "csv" && format !== "pdf") return Response.json({ error: "Unsupported export format." }, { status: 404 });

  const catalog = await loadCatalog();
  if (!catalog.ok) return Response.json({ error: "Reservation settings are temporarily unavailable." }, { status: 503 });

  const url = new URL(request.url);
  const parsed = parseReservationExportFilters(url.searchParams, catalog.catalog.settings.timeZone);
  if (!parsed.ok) return Response.json({ error: parsed.message }, { status: 400 });

  try {
    const rows = await exportReservations(parsed.filters);
    const roomName = catalog.catalog.rooms.find((room) => room.id === parsed.filters.roomId)?.name;
    const ministryName = catalog.catalog.ministries.find((ministry) => ministry.id === parsed.filters.ministryId)?.name;
    const now = new Date();
    const stamp = now.toISOString().slice(0, 10);
    const commonHeaders = {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="reservations-${stamp}.${format}"`,
      "X-Content-Type-Options": "nosniff",
      "X-Export-Row-Count": String(rows.length),
    };

    if (format === "csv") {
      return new Response(createReservationsCsv(rows, { timeZone: catalog.catalog.settings.timeZone }), {
        headers: { ...commonHeaders, "Content-Type": "text/csv; charset=utf-8" },
      });
    }

    const pdf = createReservationsPdf(rows, {
      timeZone: catalog.catalog.settings.timeZone,
      generatedAt: now,
      rangeLabel: describeExportRange(parsed.filters.from, parsed.filters.to),
      filterLabel: filterSummary(url.searchParams, roomName, ministryName),
    });
    return new Response(pdf.buffer as ArrayBuffer, {
      headers: { ...commonHeaders, "Content-Type": "application/pdf" },
    });
  } catch (error) {
    if (error instanceof ExportTooLargeError) {
      return Response.json(
        {
          error: `This export has more than ${EXPORT_MAX_ROWS.toLocaleString("en-US")} reservations. Narrow the search, filters or dates and try again.`,
        },
        { status: 413 },
      );
    }
    console.error("[reservation export] failed", error);
    return Response.json({ error: "The export could not be created. Please try again." }, { status: 500 });
  }
}
