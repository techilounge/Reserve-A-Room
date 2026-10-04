import { describe, expect, it } from "vitest";

import { collectExportPages, describeExportRange, EXPORT_MAX_ROWS, ExportTooLargeError } from "./export-limits";

const pagesOf = (total: number) => async (offset: number, limit: number) =>
  Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, i) => offset + i);

describe("collecting an export in pages", () => {
  it("reads past a single page without losing or repeating rows", async () => {
    const rows = await collectExportPages(pagesOf(2_345));
    expect(rows).toHaveLength(2_345);
    expect(new Set(rows).size).toBe(2_345);
    expect(rows[0]).toBe(0);
    expect(rows.at(-1)).toBe(2_344);
  });

  it("handles empty results and exact page multiples", async () => {
    expect(await collectExportPages(pagesOf(0))).toEqual([]);
    expect(await collectExportPages(pagesOf(2_000))).toHaveLength(2_000);
  });

  it("refuses to return a silently truncated file", async () => {
    await expect(collectExportPages(pagesOf(EXPORT_MAX_ROWS + 1))).rejects.toBeInstanceOf(ExportTooLargeError);
    await expect(collectExportPages(pagesOf(30), { pageSize: 10, maxRows: 25 })).rejects.toBeInstanceOf(ExportTooLargeError);
    expect(await collectExportPages(pagesOf(EXPORT_MAX_ROWS))).toHaveLength(EXPORT_MAX_ROWS);
  });
});

describe("export range label", () => {
  it("describes closed, open-ended and unbounded coverage", () => {
    expect(describeExportRange("2026-01-01", "2027-12-31")).toBe("Jan 1, 2026 - Dec 31, 2027");
    expect(describeExportRange("2026-03-01", undefined)).toBe("From Mar 1, 2026");
    expect(describeExportRange(undefined, "2026-03-01")).toBe("Through Mar 1, 2026");
    expect(describeExportRange(undefined, undefined)).toBe("All dates");
  });
});
