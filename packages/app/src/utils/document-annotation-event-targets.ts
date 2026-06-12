import type { DocumentAnnotationTarget, DocumentViewerKind } from "@/components/document-viewer";
import {
  buildDocxAnnotationTarget,
  buildPdfAnnotationTarget,
  buildSpreadsheetAnnotationTarget,
} from "@/utils/document-annotation-target";
import {
  buildElementPath,
  getDocxSemanticTargetElement,
  getDocxPageIndex,
  getElementLabel,
  getElementTextSnippet,
  getPdfPageContentElement,
  getPdfPageTarget,
  getSelectionTextWithin,
} from "@/utils/document-annotation-dom-targets";

export function buildPdfAnnotationTargetFromClick(input: {
  root: HTMLElement;
  eventTarget: EventTarget | null;
  clientX: number;
  clientY: number;
}): DocumentAnnotationTarget {
  const eventElement = input.eventTarget instanceof HTMLElement ? input.eventTarget : null;
  const pageTarget = getPdfPageTarget(input.root, eventElement, input.clientY);
  const contentElement = getPdfPageContentElement(pageTarget.element, eventElement);
  const rect = contentElement.getBoundingClientRect();
  return buildPdfAnnotationTarget({
    pageNumber: pageTarget.pageIndex,
    x: (input.clientX - rect.left) / rect.width,
    y: (input.clientY - rect.top) / rect.height,
    context: eventElement ? getElementTextSnippet(eventElement) : "",
  });
}

export function buildDocxAnnotationTargetFromClick(input: {
  root: HTMLElement;
  eventTarget: EventTarget | null;
}): DocumentAnnotationTarget | null {
  const target = input.eventTarget instanceof HTMLElement ? input.eventTarget : null;
  if (!target || !input.root.contains(target)) {
    return null;
  }
  const semanticTarget = getDocxSemanticTargetElement(input.root, target);
  const selectedText = getSelectionTextWithin(input.root);
  const context =
    selectedText || getElementTextSnippet(semanticTarget) || getElementTextSnippet(target);
  return buildDocxAnnotationTarget({
    label: getElementLabel(semanticTarget),
    pageNumber: getDocxPageIndex(input.root, semanticTarget),
    path: buildElementPath(input.root, semanticTarget),
    clickedPath: buildElementPath(input.root, target),
    selectedText,
    context,
  });
}

export function buildSpreadsheetAnnotationTargetFromClick(input: {
  kind: Extract<DocumentViewerKind, "csv" | "xlsx">;
  sheetName: string;
  eventTarget: EventTarget | null;
}): DocumentAnnotationTarget | null {
  const eventElement = input.eventTarget instanceof HTMLElement ? input.eventTarget : null;
  const cell = eventElement?.closest("td");
  if (!(cell instanceof HTMLElement) || cell.tagName.toLowerCase() !== "td") {
    return null;
  }
  const rowIndex = Number(cell.dataset.rowIndex);
  const columnIndex = Number(cell.dataset.columnIndex);
  if (!Number.isInteger(rowIndex) || !Number.isInteger(columnIndex)) {
    return null;
  }
  return buildSpreadsheetAnnotationTarget({
    kind: input.kind,
    sheetName: input.sheetName,
    rowIndex,
    columnIndex,
    value: cell.dataset.value ?? "",
    rawValue: cell.dataset.rawValue,
    formula: cell.dataset.formula,
    formattedValue: cell.dataset.formattedValue,
  });
}
