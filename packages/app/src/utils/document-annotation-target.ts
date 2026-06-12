import type { DocumentAnnotationTarget, DocumentViewerKind } from "@/components/document-viewer";

export function buildSpreadsheetAnnotationTarget(input: {
  kind: Extract<DocumentViewerKind, "csv" | "xlsx">;
  sheetName: string;
  rowIndex: number;
  columnIndex: number;
  value: string;
  rawValue?: string;
  formula?: string;
  formattedValue?: string;
}): DocumentAnnotationTarget {
  const address = `${columnNameFromIndex(input.columnIndex)}${input.rowIndex + 1}`;
  const rawValue = normalizeOptionalAnnotationText(input.rawValue, 1000);
  const formula = normalizeOptionalAnnotationText(input.formula, 1000);
  const formattedValue = normalizeOptionalAnnotationText(input.formattedValue, 1000);
  return {
    kind: input.kind,
    label: `${input.sheetName}!${address}`,
    locator: {
      type: "cell",
      sheet: input.sheetName,
      cell: address,
      row: input.rowIndex + 1,
      column: input.columnIndex + 1,
      ...(rawValue ? { rawValue } : {}),
      ...(formula ? { formula } : {}),
      ...(formattedValue && formattedValue !== input.value ? { formattedValue } : {}),
    },
    context: buildSpreadsheetCellContext({
      value: input.value,
      rawValue,
      formula,
      formattedValue,
    }),
  };
}

export function buildPdfAnnotationTarget(input: {
  pageNumber: number;
  x: number;
  y: number;
  rect?: {
    x1: number;
    y1: number;
    x2: number;
    y2: number;
  };
  selectedText?: string;
  context?: string;
}): DocumentAnnotationTarget {
  const selectedText = normalizeAnnotationText(input.selectedText ?? "", 1000);
  const context = selectedText || normalizeAnnotationText(input.context ?? "", 500);
  const rect = input.rect ? normalizeAnnotationRect(input.rect) : null;
  const locatorType = rect ? "region" : "point";
  return {
    kind: "pdf",
    label: rect ? `PDF 第 ${input.pageNumber} 页框选区域` : `PDF 第 ${input.pageNumber} 页点击位置`,
    locator: {
      type: locatorType,
      coordinateSpace: "page_content",
      pageNumber: input.pageNumber,
      x: roundAnnotationRatio(input.x),
      y: roundAnnotationRatio(input.y),
      ...(rect
        ? {
            x1: rect.x1,
            y1: rect.y1,
            x2: rect.x2,
            y2: rect.y2,
            width: rect.width,
            height: rect.height,
          }
        : {}),
    },
    ...(context ? { context } : {}),
  };
}

export function buildPdfBuiltinAnnotationTarget(input: {
  annotation: PdfBuiltinAnnotationInput;
  pageSize?: { width: number; height: number } | null;
}): DocumentAnnotationTarget | null {
  const rect = input.annotation.rect;
  const pageNumber =
    typeof input.annotation.pageIndex === "number" ? input.annotation.pageIndex + 1 : null;
  if (!rect || !pageNumber) {
    return null;
  }
  const normalized = normalizePdfPageRect(rect, input.pageSize);
  const annotationType = normalizePdfAnnotationType(input.annotation.type);
  const rawAnnotationType = String(input.annotation.type ?? "unknown");
  const contents = normalizeAnnotationText(input.annotation.contents ?? "", 1000);
  const subject = normalizeAnnotationText(input.annotation.subject ?? "", 200);
  const color =
    input.annotation.strokeColor ?? input.annotation.color ?? input.annotation.fontColor;
  const targetHint = buildPdfBuiltinAnnotationTargetHint({
    annotationType,
    normalized,
    pageNumber,
    pageSize: input.pageSize,
  });
  const contextParts = [
    targetHint,
    subject ? `subject=${subject}` : null,
    contents ? `contents=${contents}` : null,
    color ? `color=${color}` : null,
    typeof input.annotation.opacity === "number"
      ? `opacity=${roundAnnotationRatio(input.annotation.opacity)}`
      : null,
  ].filter(Boolean);

  return {
    kind: "pdf",
    label: `PDF 第 ${pageNumber} 页内置标注`,
    locator: buildPdfBuiltinAnnotationLocator({
      annotation: input.annotation,
      annotationType,
      rawAnnotationType,
      color,
      normalized,
      pageNumber,
      pageSize: input.pageSize,
    }),
    ...(contextParts.length > 0 ? { context: contextParts.join("; ") } : {}),
  };
}

export function buildDocxAnnotationTarget(input: {
  label: string;
  pageNumber: number;
  path: string;
  clickedPath?: string;
  selectedText?: string;
  context?: string;
}): DocumentAnnotationTarget {
  const selectedText = normalizeAnnotationText(input.selectedText ?? "", 1000);
  const context = selectedText || normalizeAnnotationText(input.context ?? "", 500);
  return {
    kind: "docx",
    label: selectedText ? "Word 选中文本" : input.label,
    locator: {
      type: selectedText ? "selection" : "element",
      pageNumber: input.pageNumber,
      path: input.path,
      ...(input.clickedPath && input.clickedPath !== input.path
        ? { clickedPath: input.clickedPath }
        : {}),
    },
    ...(context ? { context } : {}),
  };
}

function buildPdfBuiltinAnnotationLocator(input: {
  annotation: PdfBuiltinAnnotationInput;
  annotationType: string;
  rawAnnotationType: string;
  color?: string;
  normalized: ReturnType<typeof normalizePdfPageRect>;
  pageNumber: number;
  pageSize?: { width: number; height: number } | null;
}): Record<string, string | number | boolean> {
  const locator: Record<string, string | number | boolean> = {
    type: "builtin_annotation",
    coordinateSpace: input.pageSize ? "pdf_page_normalized" : "pdf_page_units",
    annotationId: input.annotation.id ?? "",
    annotationType: input.annotationType,
    rawAnnotationType: input.rawAnnotationType,
    pageNumber: input.pageNumber,
    x: input.normalized.x,
    y: input.normalized.y,
    x1: input.normalized.x1,
    y1: input.normalized.y1,
    x2: input.normalized.x2,
    y2: input.normalized.y2,
    width: input.normalized.width,
    height: input.normalized.height,
    rectPdf: JSON.stringify(input.annotation.rect),
    targetPolicy:
      "Modify visible PDF content inside or intersecting this annotation area; do not modify the annotation shape itself unless the instruction explicitly asks.",
  };
  if (input.pageSize) {
    locator.pageWidthPdf = input.pageSize.width;
    locator.pageHeightPdf = input.pageSize.height;
  }
  if (input.color) {
    locator.color = input.color;
  }
  if (typeof input.annotation.opacity === "number") {
    locator.opacity = roundAnnotationRatio(input.annotation.opacity);
  }
  if (typeof input.annotation.strokeWidth === "number") {
    locator.strokeWidth = input.annotation.strokeWidth;
  }
  if (input.annotation.segmentRects) {
    locator.segmentRectsPdf = JSON.stringify(input.annotation.segmentRects);
  }
  if (input.annotation.vertices) {
    locator.verticesPdf = JSON.stringify(input.annotation.vertices);
  }
  if (input.annotation.inkList) {
    locator.inkListPdf = JSON.stringify(input.annotation.inkList);
  }
  return locator;
}

function normalizePdfAnnotationType(type: string | number | undefined): string {
  if (typeof type === "string") {
    return type;
  }
  switch (type) {
    case 1:
      return "text";
    case 3:
      return "freeText";
    case 4:
      return "line";
    case 5:
      return "square";
    case 6:
      return "circle";
    case 7:
      return "polygon";
    case 8:
      return "polyline";
    case 9:
      return "highlight";
    case 10:
      return "underline";
    case 11:
      return "squiggly";
    case 12:
      return "strikeout";
    case 13:
      return "stamp";
    case 15:
      return "ink";
    case 28:
      return "redact";
    default:
      return "unknown";
  }
}

function buildPdfBuiltinAnnotationTargetHint(input: {
  annotationType: string;
  normalized: ReturnType<typeof normalizePdfPageRect>;
  pageNumber: number;
  pageSize?: { width: number; height: number } | null;
}): string {
  const rect = `x1=${input.normalized.x1}, y1=${input.normalized.y1}, x2=${input.normalized.x2}, y2=${input.normalized.y2}, center=(${input.normalized.x}, ${input.normalized.y})`;
  const unit = input.pageSize ? "normalized PDF page coordinates" : "raw PDF page units";
  return `target=page ${input.pageNumber} ${input.annotationType} annotation area (${unit}: ${rect}). Apply the requested edit to visible PDF content inside or intersecting this marked area, not to unrelated nearby sections.`;
}

export function normalizeAnnotationText(value: string, maxLength: number): string {
  return value.replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function normalizeOptionalAnnotationText(
  value: string | null | undefined,
  maxLength: number,
): string {
  return normalizeAnnotationText(value ?? "", maxLength);
}

function buildSpreadsheetCellContext(input: {
  value: string;
  rawValue: string;
  formula: string;
  formattedValue: string;
}): string {
  const value = normalizeAnnotationText(input.value, 1000);
  if (!input.rawValue && !input.formula && !input.formattedValue) {
    return value;
  }
  const parts = [
    value ? `display=${value}` : null,
    input.rawValue && input.rawValue !== value ? `raw=${input.rawValue}` : null,
    input.formula ? `formula ${input.formula}` : null,
    input.formattedValue && input.formattedValue !== value
      ? `formatted=${input.formattedValue}`
      : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join("; ") : "";
}

export function roundAnnotationRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, Math.round(value * 10_000) / 10_000));
}

function normalizeAnnotationRect(rect: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}): { x1: number; y1: number; x2: number; y2: number; width: number; height: number } | null {
  const x1 = roundAnnotationRatio(Math.min(rect.x1, rect.x2));
  const y1 = roundAnnotationRatio(Math.min(rect.y1, rect.y2));
  const x2 = roundAnnotationRatio(Math.max(rect.x1, rect.x2));
  const y2 = roundAnnotationRatio(Math.max(rect.y1, rect.y2));
  const width = roundAnnotationRatio(x2 - x1);
  const height = roundAnnotationRatio(y2 - y1);
  return width > 0 && height > 0 ? { x1, y1, x2, y2, width, height } : null;
}

interface AnnotationPosition {
  x: number;
  y: number;
}

interface PdfBuiltinAnnotationInput {
  id?: string;
  type?: string | number;
  pageIndex?: number;
  rect?: AnnotationRect;
  contents?: string;
  subject?: string;
  author?: string;
  color?: string;
  strokeColor?: string;
  fontColor?: string;
  opacity?: number;
  strokeWidth?: number;
  segmentRects?: AnnotationRect[];
  vertices?: AnnotationPosition[];
  inkList?: { points?: AnnotationPosition[] }[];
}

interface AnnotationRect {
  origin: AnnotationPosition;
  size: {
    width: number;
    height: number;
  };
}

function normalizePdfPageRect(
  rect: AnnotationRect,
  pageSize?: { width: number; height: number } | null,
): {
  x: number;
  y: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
} {
  const x1 = rect.origin.x;
  const y1 = rect.origin.y;
  const x2 = rect.origin.x + rect.size.width;
  const y2 = rect.origin.y + rect.size.height;
  const divisorWidth = pageSize?.width && pageSize.width > 0 ? pageSize.width : 1;
  const divisorHeight = pageSize?.height && pageSize.height > 0 ? pageSize.height : 1;
  const normalizedX1 = pageSize ? roundAnnotationRatio(x1 / divisorWidth) : roundPdfUnit(x1);
  const normalizedY1 = pageSize ? roundAnnotationRatio(y1 / divisorHeight) : roundPdfUnit(y1);
  const normalizedX2 = pageSize ? roundAnnotationRatio(x2 / divisorWidth) : roundPdfUnit(x2);
  const normalizedY2 = pageSize ? roundAnnotationRatio(y2 / divisorHeight) : roundPdfUnit(y2);
  const width = pageSize
    ? roundAnnotationRatio(rect.size.width / divisorWidth)
    : roundPdfUnit(rect.size.width);
  const height = pageSize
    ? roundAnnotationRatio(rect.size.height / divisorHeight)
    : roundPdfUnit(rect.size.height);
  return {
    x: pageSize ? roundAnnotationRatio((x1 + x2) / 2 / divisorWidth) : roundPdfUnit((x1 + x2) / 2),
    y: pageSize ? roundAnnotationRatio((y1 + y2) / 2 / divisorHeight) : roundPdfUnit((y1 + y2) / 2),
    x1: normalizedX1,
    y1: normalizedY1,
    x2: normalizedX2,
    y2: normalizedY2,
    width,
    height,
  };
}

function roundPdfUnit(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

export function columnNameFromIndex(index: number): string {
  let value = index + 1;
  let name = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}
