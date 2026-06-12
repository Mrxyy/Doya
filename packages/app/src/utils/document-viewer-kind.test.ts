import { describe, expect, it } from "vitest";
import { resolveDocumentViewerKind } from "./document-viewer-kind";

describe("resolveDocumentViewerKind", () => {
  it("resolves document preview kinds from file extensions", () => {
    expect(resolveDocumentViewerKind({ path: "brief.PDF", mimeType: null })).toBe("pdf");
    expect(resolveDocumentViewerKind({ path: "proposal.docx", mimeType: null })).toBe("docx");
    expect(resolveDocumentViewerKind({ path: "deck.pptx", mimeType: null })).toBe("pptx");
    expect(resolveDocumentViewerKind({ path: "budget.csv", mimeType: null })).toBe("csv");
    expect(resolveDocumentViewerKind({ path: "budget.xlsx", mimeType: null })).toBe("xlsx");
    expect(resolveDocumentViewerKind({ path: "legacy-budget.xls", mimeType: null })).toBe("xlsx");
  });

  it("resolves document preview kinds from MIME types", () => {
    expect(resolveDocumentViewerKind({ path: "download", mimeType: "application/pdf" })).toBe(
      "pdf",
    );
    expect(
      resolveDocumentViewerKind({
        path: "download",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      }),
    ).toBe("docx");
    expect(
      resolveDocumentViewerKind({
        path: "download",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      }),
    ).toBe("pptx");
    expect(resolveDocumentViewerKind({ path: "download", mimeType: "text/csv" })).toBe("csv");
    expect(
      resolveDocumentViewerKind({
        path: "download",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).toBe("xlsx");
    expect(
      resolveDocumentViewerKind({
        path: "download",
        mimeType: "application/vnd.ms-excel",
      }),
    ).toBe("xlsx");
  });

  it("ignores unsupported files", () => {
    expect(resolveDocumentViewerKind({ path: "notes.txt", mimeType: "text/plain" })).toBeNull();
  });
});
