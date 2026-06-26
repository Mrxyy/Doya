import * as XLSX from "xlsx";
import type { DocumentViewerKind } from "@/components/document-viewer";

export interface SpreadsheetPreview {
  sheetNames: string[];
  activeSheetName: string;
  rows: SpreadsheetPreviewRow[];
  rowCount: number;
  columnCount: number;
  startColumnIndex: number;
  truncatedRows: boolean;
  truncatedColumns: boolean;
}

export interface SpreadsheetPreviewCell {
  text: string;
  sheetColumnIndex: number;
  rawValue?: string;
  formula?: string;
  formattedValue?: string;
}

export interface SpreadsheetPreviewRow {
  sheetRowIndex: number;
  cells: SpreadsheetPreviewCell[];
}

export interface XSpreadsheetCellData {
  text: string;
  merge?: [number, number];
}

export interface XSpreadsheetSheetData {
  name: string;
  rows: {
    len: number;
    [rowIndex: number]:
      | {
          cells: Record<number, XSpreadsheetCellData>;
          height?: number;
        }
      | number;
  };
  cols?: {
    len: number;
    [columnIndex: number]: { width?: number } | number;
  };
  merges?: string[];
}

export const SPREADSHEET_MAX_ROWS = 500;
export const SPREADSHEET_MAX_COLUMNS = 80;

export function parseSpreadsheetPreview(input: {
  kind: Extract<DocumentViewerKind, "csv" | "xlsx">;
  bytes: Uint8Array;
  activeSheetName?: string;
}): SpreadsheetPreview {
  const workbook =
    input.kind === "csv"
      ? XLSX.read(new TextDecoder().decode(input.bytes), { type: "string", raw: true })
      : XLSX.read(input.bytes, { type: "array", cellDates: true });
  const sheetNames = workbook.SheetNames;
  const activeSheetName =
    input.activeSheetName && sheetNames.includes(input.activeSheetName)
      ? input.activeSheetName
      : (sheetNames[0] ?? "Sheet1");
  const sheet = workbook.Sheets[activeSheetName];
  if (!sheet) {
    return {
      sheetNames,
      activeSheetName,
      rows: [],
      rowCount: 0,
      columnCount: 0,
      startColumnIndex: 0,
      truncatedRows: false,
      truncatedColumns: false,
    };
  }

  const range = XLSX.utils.decode_range(sheet["!ref"] ?? "A1");
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  const rows = Array.from(
    { length: Math.min(rowCount, SPREADSHEET_MAX_ROWS) },
    (_row, rowOffset): SpreadsheetPreviewRow => {
      const sheetRowIndex = range.s.r + rowOffset;
      return {
        sheetRowIndex,
        cells: Array.from(
          { length: Math.min(columnCount, SPREADSHEET_MAX_COLUMNS) },
          (_cell, columnOffset) =>
            readSpreadsheetPreviewCell(sheet, {
              rowIndex: sheetRowIndex,
              columnIndex: range.s.c + columnOffset,
            }),
        ),
      };
    },
  );
  return {
    sheetNames,
    activeSheetName,
    rows,
    rowCount,
    columnCount,
    startColumnIndex: range.s.c,
    truncatedRows: rowCount > SPREADSHEET_MAX_ROWS,
    truncatedColumns: columnCount > SPREADSHEET_MAX_COLUMNS,
  };
}

export function readSpreadsheetPreviewCell(
  sheet: XLSX.WorkSheet,
  input: { rowIndex: number; columnIndex: number },
): SpreadsheetPreviewCell {
  const address = XLSX.utils.encode_cell({ r: input.rowIndex, c: input.columnIndex });
  const cell = sheet[address];
  if (!cell) {
    return { text: "", sheetColumnIndex: input.columnIndex };
  }
  const rawValue = cell.v == null ? "" : String(cell.v);
  const formula = typeof cell.f === "string" && cell.f.trim() ? `=${cell.f.trim()}` : "";
  const formattedValue = cell.w == null ? "" : String(cell.w);
  return {
    text: formattedValue || rawValue || formula,
    sheetColumnIndex: input.columnIndex,
    ...(rawValue ? { rawValue } : {}),
    ...(formula ? { formula } : {}),
    ...(formattedValue ? { formattedValue } : {}),
  };
}

export function createXSpreadsheetData(bytes: Uint8Array): XSpreadsheetSheetData[] {
  const workbook = XLSX.read(bytes, {
    cellDates: true,
    type: "array",
  });
  return workbook.SheetNames.map((sheetName) =>
    createXSpreadsheetSheetData({
      sheetName,
      sheet: workbook.Sheets[sheetName],
    }),
  );
}

function createXSpreadsheetSheetData(input: {
  sheetName: string;
  sheet: XLSX.WorkSheet | undefined;
}): XSpreadsheetSheetData {
  const range = XLSX.utils.decode_range(input.sheet?.["!ref"] ?? "A1");
  const rows: XSpreadsheetSheetData["rows"] = {
    len: Math.max(range.e.r + 1, 100),
  };
  const cols: NonNullable<XSpreadsheetSheetData["cols"]> = {
    len: Math.max(range.e.c + 1, 26),
  };
  const mergeRanges = input.sheet?.["!merges"] ?? [];
  const merges = mergeRanges.map((mergeRange) => XLSX.utils.encode_range(mergeRange));

  applyXSpreadsheetColumns({ cols, sheet: input.sheet });

  for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
    const row = createXSpreadsheetRow({ rowIndex, sheet: input.sheet });
    for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
      const cell = createXSpreadsheetCell({
        columnIndex,
        mergeRanges,
        rowIndex,
        sheet: input.sheet,
      });
      if (!cell) {
        continue;
      }
      row.cells[columnIndex] = cell;
    }
    if (shouldIncludeXSpreadsheetRow(row)) {
      rows[rowIndex] = row;
    }
  }

  return {
    cols,
    merges,
    name: input.sheetName,
    rows,
  };
}

function applyXSpreadsheetColumns(input: {
  cols: NonNullable<XSpreadsheetSheetData["cols"]>;
  sheet: XLSX.WorkSheet | undefined;
}): void {
  const sourceColumns = input.sheet?.["!cols"] ?? [];
  sourceColumns.forEach((column, columnIndex) => {
    const width = typeof column.wpx === "number" ? column.wpx : undefined;
    if (width) {
      input.cols[columnIndex] = { width };
    }
  });
}

function createXSpreadsheetRow(input: { rowIndex: number; sheet: XLSX.WorkSheet | undefined }): {
  cells: Record<number, XSpreadsheetCellData>;
  height?: number;
} {
  const sourceRow = input.sheet?.["!rows"]?.[input.rowIndex];
  const rowHeight = typeof sourceRow?.hpx === "number" ? sourceRow.hpx : undefined;
  return {
    cells: {},
    ...(rowHeight ? { height: rowHeight } : {}),
  };
}

function createXSpreadsheetCell(input: {
  columnIndex: number;
  rowIndex: number;
  sheet: XLSX.WorkSheet | undefined;
  mergeRanges: XLSX.Range[];
}): XSpreadsheetCellData | null {
  const address = XLSX.utils.encode_cell({ c: input.columnIndex, r: input.rowIndex });
  const cell = input.sheet?.[address];
  const merge = findMergeForCell(input.mergeRanges, input.rowIndex, input.columnIndex);
  if (!cell && !merge) {
    return null;
  }
  const nextCell: XSpreadsheetCellData = {
    text: getSpreadsheetCellText(cell),
  };
  if (merge) {
    nextCell.merge = [merge.e.r - merge.s.r, merge.e.c - merge.s.c];
  }
  return nextCell;
}

function shouldIncludeXSpreadsheetRow(input: {
  cells: Record<number, XSpreadsheetCellData>;
  height?: number;
}): boolean {
  return Object.keys(input.cells).length > 0 || input.height !== undefined;
}

function findMergeForCell(
  merges: XLSX.Range[],
  rowIndex: number,
  columnIndex: number,
): XLSX.Range | null {
  return merges.find((merge) => merge.s.r === rowIndex && merge.s.c === columnIndex) ?? null;
}

function getSpreadsheetCellText(cell: XLSX.CellObject | undefined): string {
  if (!cell) {
    return "";
  }
  const formula = typeof cell.f === "string" && cell.f.trim() ? `=${cell.f.trim()}` : "";
  if (cell.w != null) {
    return String(cell.w);
  }
  if (cell.v != null) {
    return String(cell.v);
  }
  return formula;
}
