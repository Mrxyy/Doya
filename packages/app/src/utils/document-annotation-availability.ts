import type { DocumentViewerKind } from "@/components/document-viewer";
import { isDocumentAnnotationKind } from "@/utils/document-annotation-prompt";

export type DocumentAnnotationAvailability =
  | { state: "enabled" }
  | { state: "missing-agent" }
  | { state: "hidden" };

export function resolveDocumentAnnotationAvailability(input: {
  documentKind: DocumentViewerKind | null | undefined;
  sourceAgentId: string | null | undefined;
}): DocumentAnnotationAvailability {
  if (!input.documentKind || !isDocumentAnnotationKind(input.documentKind)) {
    return { state: "hidden" };
  }
  if (!input.sourceAgentId?.trim()) {
    return { state: "missing-agent" };
  }
  return { state: "enabled" };
}
