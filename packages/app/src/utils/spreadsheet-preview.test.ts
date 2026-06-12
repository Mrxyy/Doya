import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseSpreadsheetPreview, readSpreadsheetPreviewCell } from "./spreadsheet-preview";

function writeWorkbookBytes(workbook: XLSX.WorkBook): Uint8Array {
  return new Uint8Array(XLSX.write(workbook, { bookType: "xlsx", type: "array" }));
}

describe("spreadsheet preview", () => {
  it("preserves real sheet coordinates when the used range does not start at A1", () => {
    const sheet: XLSX.WorkSheet = {
      "!ref": "B2:C3",
      B2: { t: "s", v: "Name", w: "Name" },
      C2: { t: "s", v: "Budget", w: "Budget" },
      B3: { t: "s", v: "Food", w: "Food" },
      C3: { t: "n", v: 150000, f: "SUM(C4:C5)", z: "$#,##0" },
    };
    const bytes = writeWorkbookBytes({
      SheetNames: ["Budget"],
      Sheets: { Budget: sheet },
    });

    const preview = parseSpreadsheetPreview({ kind: "xlsx", bytes });

    expect(preview.activeSheetName).toBe("Budget");
    expect(preview.startColumnIndex).toBe(1);
    expect(preview.rowCount).toBe(2);
    expect(preview.columnCount).toBe(2);
    expect(preview.rows[0]?.sheetRowIndex).toBe(1);
    expect(preview.rows[1]?.sheetRowIndex).toBe(2);
    expect(preview.rows[1]?.cells[1]).toMatchObject({
      text: "$150,000",
      sheetColumnIndex: 2,
      rawValue: "150000",
      formula: "=SUM(C4:C5)",
      formattedValue: "$150,000",
    });
  });

  it("reads blank cells with their real sheet column index", () => {
    const cell = readSpreadsheetPreviewCell(
      {
        "!ref": "C5:C5",
      },
      { rowIndex: 4, columnIndex: 2 },
    );

    expect(cell).toEqual({ text: "", sheetColumnIndex: 2 });
  });
});
