import { describe, expect, it } from "vitest";
import {
  createDocumentBytesSignature,
  createDocumentPreviewRevision,
} from "./document-preview-revision";

describe("document preview revision", () => {
  it("detects byte changes even when size and metadata stay the same", () => {
    const before = new Uint8Array(128).fill(7);
    const after = new Uint8Array(before);
    after[63] = 8;

    expect(createDocumentBytesSignature(before)).not.toBe(createDocumentBytesSignature(after));
    expect(
      createDocumentPreviewRevision({
        path: "docs/report.docx",
        size: 128,
        modifiedAt: "2026-06-12T00:00:00.000Z",
        documentKind: "docx",
        bytes: before,
      }),
    ).not.toBe(
      createDocumentPreviewRevision({
        path: "docs/report.docx",
        size: 128,
        modifiedAt: "2026-06-12T00:00:00.000Z",
        documentKind: "docx",
        bytes: after,
      }),
    );
  });

  it("includes path and document kind in the revision identity", () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const base = {
      size: 3,
      modifiedAt: "2026-06-12T00:00:00.000Z",
      bytes,
    };

    expect(
      createDocumentPreviewRevision({ ...base, path: "docs/report.docx", documentKind: "docx" }),
    ).not.toBe(
      createDocumentPreviewRevision({ ...base, path: "docs/report.pdf", documentKind: "pdf" }),
    );
  });
});
