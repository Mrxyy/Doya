import { describe, expect, it } from "vitest";
import {
  buildDocxAnnotationTarget,
  buildPdfAnnotationTarget,
  buildPdfBuiltinAnnotationTarget,
  buildSpreadsheetAnnotationTarget,
  columnNameFromIndex,
  normalizeAnnotationText,
  roundAnnotationRatio,
} from "./document-annotation-target";

describe("document annotation target", () => {
  it("builds spreadsheet targets with stable sheet and cell locators", () => {
    expect(columnNameFromIndex(0)).toBe("A");
    expect(columnNameFromIndex(25)).toBe("Z");
    expect(columnNameFromIndex(26)).toBe("AA");

    expect(
      buildSpreadsheetAnnotationTarget({
        kind: "xlsx",
        sheetName: "Summary",
        rowIndex: 3,
        columnIndex: 27,
        value: "$120,000",
      }),
    ).toEqual({
      kind: "xlsx",
      label: "Summary!AB4",
      locator: {
        type: "cell",
        sheet: "Summary",
        cell: "AB4",
        row: 4,
        column: 28,
      },
      context: "$120,000",
    });
  });

  it("adds spreadsheet formula and raw value hints when available", () => {
    expect(
      buildSpreadsheetAnnotationTarget({
        kind: "xlsx",
        sheetName: "Budget",
        rowIndex: 1,
        columnIndex: 2,
        value: "$150,000",
        rawValue: "150000",
        formula: "=SUM(C3:C6)",
        formattedValue: "$150,000",
      }),
    ).toEqual({
      kind: "xlsx",
      label: "Budget!C2",
      locator: {
        type: "cell",
        sheet: "Budget",
        cell: "C2",
        row: 2,
        column: 3,
        rawValue: "150000",
        formula: "=SUM(C3:C6)",
      },
      context: "display=$150,000; raw=150000; formula =SUM(C3:C6)",
    });
  });

  it("builds PDF point targets with normalized preview coordinates", () => {
    expect(roundAnnotationRatio(-0.2)).toBe(0);
    expect(roundAnnotationRatio(1.2)).toBe(1);
    expect(roundAnnotationRatio(0.123456)).toBe(0.1235);

    expect(
      buildPdfAnnotationTarget({
        pageNumber: 2,
        x: 0.25,
        y: 0.5,
        context: "附近文本",
      }),
    ).toEqual({
      kind: "pdf",
      label: "PDF 第 2 页点击位置",
      locator: {
        type: "point",
        coordinateSpace: "page_content",
        pageNumber: 2,
        x: 0.25,
        y: 0.5,
      },
      context: "附近文本",
    });
  });

  it("builds PDF region targets with optional context text", () => {
    expect(
      buildPdfAnnotationTarget({
        pageNumber: 3,
        x: 0.1,
        y: 0.2,
        rect: {
          x1: 0.05,
          y1: 0.1,
          x2: 0.25,
          y2: 0.3,
        },
        selectedText: "  风险\n提示  ",
      }),
    ).toEqual({
      kind: "pdf",
      label: "PDF 第 3 页框选区域",
      locator: {
        type: "region",
        coordinateSpace: "page_content",
        pageNumber: 3,
        x: 0.1,
        y: 0.2,
        x1: 0.05,
        y1: 0.1,
        x2: 0.25,
        y2: 0.3,
        width: 0.2,
        height: 0.2,
      },
      context: "风险 提示",
    });
  });

  it("builds PDF region targets from visual rectangles without selectable text", () => {
    expect(
      buildPdfAnnotationTarget({
        pageNumber: 4,
        x: 0.5,
        y: 0.45,
        rect: {
          x1: 0.2,
          y1: 0.3,
          x2: 0.8,
          y2: 0.6,
        },
      }),
    ).toEqual({
      kind: "pdf",
      label: "PDF 第 4 页框选区域",
      locator: {
        type: "region",
        coordinateSpace: "page_content",
        pageNumber: 4,
        x: 0.5,
        y: 0.45,
        x1: 0.2,
        y1: 0.3,
        x2: 0.8,
        y2: 0.6,
        width: 0.6,
        height: 0.3,
      },
    });
  });

  it("builds PDF builtin annotation targets from viewer annotation objects", () => {
    expect(
      buildPdfBuiltinAnnotationTarget({
        annotation: {
          id: "anno-1",
          type: "square",
          pageIndex: 0,
          rect: { origin: { x: 100, y: 200 }, size: { width: 120, height: 40 } },
          contents: "改成红色字",
          strokeColor: "#ff0000",
          opacity: 0.5,
        },
        pageSize: { width: 400, height: 800 },
      }),
    ).toEqual({
      kind: "pdf",
      label: "PDF 第 1 页内置标注",
      locator: {
        type: "builtin_annotation",
        coordinateSpace: "pdf_page_normalized",
        annotationId: "anno-1",
        annotationType: "square",
        rawAnnotationType: "square",
        pageNumber: 1,
        x: 0.4,
        y: 0.275,
        x1: 0.25,
        y1: 0.25,
        x2: 0.55,
        y2: 0.3,
        width: 0.3,
        height: 0.05,
        rectPdf: JSON.stringify({ origin: { x: 100, y: 200 }, size: { width: 120, height: 40 } }),
        targetPolicy:
          "Modify visible PDF content inside or intersecting this annotation area; do not modify the annotation shape itself unless the instruction explicitly asks.",
        pageWidthPdf: 400,
        pageHeightPdf: 800,
        color: "#ff0000",
        opacity: 0.5,
      },
      context:
        "target=page 1 square annotation area (normalized PDF page coordinates: x1=0.25, y1=0.25, x2=0.55, y2=0.3, center=(0.4, 0.275)). Apply the requested edit to visible PDF content inside or intersecting this marked area, not to unrelated nearby sections.; contents=改成红色字; color=#ff0000; opacity=0.5",
    });
  });

  it("builds DOCX targets from selected text or element path hints", () => {
    expect(normalizeAnnotationText(" A\n\nB\tC ", 10)).toBe("A B C");

    expect(
      buildDocxAnnotationTarget({
        label: "p: Old title",
        pageNumber: 1,
        path: "section:nth-of-type(1) > p:nth-of-type(2)",
        context: "Old title",
      }),
    ).toEqual({
      kind: "docx",
      label: "p: Old title",
      locator: {
        type: "element",
        pageNumber: 1,
        path: "section:nth-of-type(1) > p:nth-of-type(2)",
      },
      context: "Old title",
    });

    expect(
      buildDocxAnnotationTarget({
        label: "p: ignored",
        pageNumber: 4,
        path: "section:nth-of-type(4) > p:nth-of-type(1)",
        clickedPath: "section:nth-of-type(4) > p:nth-of-type(1) > span:nth-of-type(1)",
        selectedText: " Selected copy ",
      }),
    ).toMatchObject({
      kind: "docx",
      label: "Word 选中文本",
      locator: {
        type: "selection",
        pageNumber: 4,
        path: "section:nth-of-type(4) > p:nth-of-type(1)",
        clickedPath: "section:nth-of-type(4) > p:nth-of-type(1) > span:nth-of-type(1)",
      },
      context: "Selected copy",
    });
  });
});
