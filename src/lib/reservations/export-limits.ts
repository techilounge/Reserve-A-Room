import { formatMediumDate, type LocalDate } from "@/lib/datetime";

/** Rows fetched per request. Supabase also caps each API response at 1,000 rows. */
export const EXPORT_PAGE_SIZE = 1000;
/**
 * Safety ceiling for one export, so a single request can't exhaust the serverless
 * function's memory or time. It's far above any realistic volume for the church.
 */
export const EXPORT_MAX_ROWS = 20_000;

export class ExportTooLargeError extends Error {
  constructor() {
    super(`This export has more than ${EXPORT_MAX_ROWS.toLocaleString("en-US")} reservations.`);
    this.name = "ExportTooLargeError";
  }
}

/**
 * Reads an export in pages until a short page signals the end. Throws `ExportTooLargeError`
 * instead of returning a silently truncated file.
 */
export async function collectExportPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<T[]>,
  { pageSize = EXPORT_PAGE_SIZE, maxRows = EXPORT_MAX_ROWS }: { pageSize?: number; maxRows?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await fetchPage(offset, pageSize);
    rows.push(...page);
    if (rows.length > maxRows) throw new ExportTooLargeError();
    if (page.length < pageSize) return rows;
  }
}

/** Human-readable date coverage for the PDF header. */
export function describeExportRange(from?: LocalDate, to?: LocalDate): string {
  if (from && to) return `${formatMediumDate(from)} - ${formatMediumDate(to)}`;
  if (from) return `From ${formatMediumDate(from)}`;
  if (to) return `Through ${formatMediumDate(to)}`;
  return "All dates";
}
