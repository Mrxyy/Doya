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
