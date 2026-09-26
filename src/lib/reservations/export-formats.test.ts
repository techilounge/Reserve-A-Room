import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import type { ExportReservationRow } from "@/lib/data/admin";

import { createReservationsCsv, createReservationsPdf, safeSpreadsheetCell } from "./export-formats";

const row: ExportReservationRow = {
  id: "00000000-0000-4000-8000-000000000001",
  reference_code: "RAR-20260925-TEST",
  status: "approved",
  source: "guest",
  room_name: "Conference Room",
  start_at: "2026-10-05T14:00:00.000Z",
  end_at: "2026-10-05T15:00:00.000Z",
  requester_first_name: "Grace",
  requester_last_name: "Hopper",
  requester_email: "grace@example.org",
  requester_phone: "+15125550123",
  ministry_name: "=HYPERLINK(\"bad\")",
  purpose: "+unsafe",
  estimated_attendance: 12,
  approval_required_at_submission: false,
  created_at: "2026-09-25T12:00:00.000Z",
};

describe("reservation export formats", () => {
  it("neutralizes formula-like spreadsheet cells", () => {
    expect(safeSpreadsheetCell("=1+1")).toBe("'=1+1");
    expect(safeSpreadsheetCell("  @cmd")).toBe("'  @cmd");
    expect(safeSpreadsheetCell("ordinary")).toBe("ordinary");
  });

  it("creates an Excel-compatible UTF-8 CSV with protected values", () => {
    const csv = createReservationsCsv([row], { timeZone: "America/Chicago" });
    expect(csv.startsWith("\uFEFF")).toBe(true);
    expect(csv).toContain("\"'=HYPERLINK(\"\"bad\"\")\"");
    expect(csv).toContain("\"'+unsafe\"");
    expect(csv).toContain("RAR-20260925-TEST");
  });

  it("creates a multi-page PDF with repeated report headers", () => {
    const pdf = createReservationsPdf(Array.from({ length: 25 }, () => row), {
      timeZone: "America/Chicago",
      generatedAt: new Date("2026-09-25T12:00:00.000Z"),
      rangeLabel: "Jan 1, 2026 - Dec 31, 2026",
      filterLabel: "All statuses",
    });
    const body = Buffer.from(pdf).toString("ascii");
    expect(body.startsWith("%PDF-1.4")).toBe(true);
    expect(body.match(/Reservation export/g)).toHaveLength(3);
    expect(body).toContain("Page 3 of 3");
    expect(body.endsWith("%%EOF\n")).toBe(true);
    if (process.env.PDF_QA_OUTPUT_UNIT) {
      const output = path.resolve(process.env.PDF_QA_OUTPUT_UNIT);
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, pdf);
    }
  });
});
