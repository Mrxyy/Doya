import type { DocumentViewerKind } from "@/components/document-viewer";

export function resolveDocumentViewerKind(input: {
  path: string;
  mimeType: string | null | undefined;
}): DocumentViewerKind | null {
  const normalizedPath = input.path.toLowerCase();
  const mimeType = input.mimeType?.toLowerCase() ?? "";
  if (normalizedPath.endsWith(".pdf") || mimeType === "application/pdf") {
    return "pdf";
  }
  if (
    normalizedPath.endsWith(".docx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    return "docx";
  }
  if (
    normalizedPath.endsWith(".pptx") ||
    mimeType === "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    return "pptx";
  }
  if (normalizedPath.endsWith(".csv") || mimeType === "text/csv") {
    return "csv";
  }
  if (
    normalizedPath.endsWith(".xlsx") ||
    normalizedPath.endsWith(".xls") ||
    mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    mimeType === "application/vnd.ms-excel"
  ) {
    return "xlsx";
  }
  return null;
}
