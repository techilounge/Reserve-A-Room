import { formatInstant, formatMediumDate, formatTime, toLocalParts } from "@/lib/datetime";
import type { ExportReservationRow } from "@/lib/data/admin";

export type ReservationExportOptions = {
  timeZone: string;
  generatedAt: Date;
  rangeLabel: string;
  filterLabel: string;
};

/** Neutralizes spreadsheet formulas while preserving the visible value. */
export function safeSpreadsheetCell(value: unknown): string {
  const text = String(value ?? "").replace(/[\r\n]+/g, " ");
  return /^\s*[=+\-@]/.test(text) ? `'${text}` : text;
}

function csvCell(value: unknown): string {
  return `"${safeSpreadsheetCell(value).replaceAll('"', '""')}"`;
}

export function createReservationsCsv(
  rows: readonly ExportReservationRow[],
  { timeZone }: Pick<ReservationExportOptions, "timeZone">,
): string {
  const headers = [
    "Reference",
    "Status",
    "Date",
    "Start",
    "End",
    "Room",
    "Requester",
    "Email",
    "Phone",
    "Ministry / Group",
    "Purpose",
    "Attendance",
    "Source",
    "Approval Type",
    "Created",
  ];
  const lines = rows.map((row) => {
    const start = toLocalParts(row.start_at, timeZone);
    const end = toLocalParts(row.end_at, timeZone);
    return [
      row.reference_code,
      row.status,
      start.date,
      formatTime(start.time),
      formatTime(end.time),
      row.room_name,
      `${row.requester_first_name} ${row.requester_last_name}`,
      row.requester_email,
      row.requester_phone,
      row.ministry_name,
      row.purpose,
      row.estimated_attendance,
      row.source,
      row.approval_required_at_submission ? "Approval required" : "Instant",
      formatInstant(row.created_at, timeZone),
    ].map(csvCell).join(",");
  });
  return `\uFEFF${headers.map(csvCell).join(",")}\r\n${lines.join("\r\n")}${lines.length ? "\r\n" : ""}`;
}

function ascii(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7E]/g, "-")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function clipped(value: unknown, max: number): string {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 3))}...`;
}

function text(x: number, y: number, value: unknown, size = 8, bold = false, color = "0.043 0.106 0.200") {
  return `BT /${bold ? "F2" : "F1"} ${size} Tf ${color} rg ${x} ${y} Td (${ascii(value)}) Tj ET`;
}

function buildPage(
  rows: readonly ExportReservationRow[],
  page: number,
  pages: number,
  options: ReservationExportOptions,
): string {
  const commands: string[] = [
    "0.012 0.118 0.278 rg 0 540 792 72 re f",
    "0.871 0.651 0.129 rg 0 536 792 4 re f",
    text(36, 577, "Reserve-A-Room", 18, true, "1 1 1"),
    text(36, 558, "Reservation export", 11, false, "1 1 1"),
    text(710, 577, `Page ${page} of ${pages}`, 8, false, "1 1 1"),
    text(36, 516, `Range: ${options.rangeLabel}`, 9, true),
    text(36, 501, `Filters: ${clipped(options.filterLabel, 125)}`, 8),
    text(36, 486, `Generated: ${formatInstant(options.generatedAt, options.timeZone)} (${options.timeZone})`, 8),
    "0.918 0.941 0.973 rg 36 455 720 24 re f",
  ];

  const columns = [
    { x: 42, label: "WHEN", width: 100 },
    { x: 145, label: "ROOM", width: 90 },
    { x: 238, label: "REQUESTER", width: 150 },
    { x: 391, label: "MINISTRY / PURPOSE", width: 225 },
    { x: 619, label: "STATUS / REFERENCE", width: 131 },
  ];
  for (const column of columns) commands.push(text(column.x, 464, column.label, 7, true, "0.294 0.353 0.447"));

  rows.forEach((row, index) => {
    const top = 455 - index * 32;
    const baseline = top - 12;
    if (index % 2 === 1) commands.push(`0.976 0.984 0.996 rg 36 ${top - 32} 720 32 re f`);
    commands.push(`0.859 0.886 0.925 RG 0.5 w 36 ${top - 32} m 756 ${top - 32} l S`);
    const start = toLocalParts(row.start_at, options.timeZone);
    const end = toLocalParts(row.end_at, options.timeZone);
    commands.push(text(42, baseline, formatMediumDate(start.date), 8, true));
    commands.push(text(42, baseline - 11, `${formatTime(start.time)} - ${formatTime(end.time)}`, 7));
    commands.push(text(145, baseline, clipped(row.room_name, 22), 8, true));
    commands.push(text(145, baseline - 11, `${row.estimated_attendance} attending`, 7));
    commands.push(text(238, baseline, clipped(`${row.requester_first_name} ${row.requester_last_name}`, 32), 8, true));
    commands.push(text(238, baseline - 11, clipped(row.requester_email, 35), 7));
    commands.push(text(391, baseline, clipped(row.ministry_name, 48), 8, true));
    commands.push(text(391, baseline - 11, clipped(row.purpose, 58), 7));
    commands.push(text(619, baseline, row.status.toUpperCase(), 8, true));
    commands.push(text(619, baseline - 11, row.reference_code, 7));
  });

  commands.push(text(36, 28, "Stonehill Seventh-day Adventist Church", 7, false, "0.294 0.353 0.447"));
  commands.push(text(650, 28, `${rows.length} row${rows.length === 1 ? "" : "s"} on this page`, 7, false, "0.294 0.353 0.447"));
  return commands.join("\n");
}

/** Dependency-free PDF 1.4 writer using built-in Helvetica fonts. */
export function createReservationsPdf(rows: readonly ExportReservationRow[], options: ReservationExportOptions): Uint8Array {
  const rowsPerPage = 12;
  const chunks: ExportReservationRow[][] = [];
  for (let index = 0; index < rows.length; index += rowsPerPage) chunks.push(rows.slice(index, index + rowsPerPage));
  if (!chunks.length) chunks.push([]);

  const objects: string[] = [];
  const pageIds = chunks.map((_, index) => 5 + index * 2);
  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;
  objects[3] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  objects[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>";

  chunks.forEach((chunk, index) => {
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const content = buildPage(chunk, index + 1, chunks.length, options);
    objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 792 612] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId] = `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`;
  });

  let output = "%PDF-1.4\n%RAR\n";
  const offsets = [0];
  for (let id = 1; id < objects.length; id += 1) {
    offsets[id] = Buffer.byteLength(output, "ascii");
    output += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(output, "ascii");
  output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id += 1) output += `${String(offsets[id]).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new Uint8Array(Buffer.from(output, "ascii"));
}
