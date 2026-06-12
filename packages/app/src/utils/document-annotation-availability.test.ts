import { describe, expect, it } from "vitest";
import { resolveDocumentAnnotationAvailability } from "./document-annotation-availability";

describe("document annotation availability", () => {
  it("enables annotations for supported document previews with a source agent", () => {
    expect(
      resolveDocumentAnnotationAvailability({
        documentKind: "docx",
        sourceAgentId: "agent-1",
      }),
    ).toEqual({ state: "enabled" });
  });

  it("shows a missing-agent state for supported previews opened without an agent source", () => {
    expect(
      resolveDocumentAnnotationAvailability({
        documentKind: "xlsx",
        sourceAgentId: null,
      }),
    ).toEqual({ state: "missing-agent" });
  });

  it("trims source agent ids before deciding availability", () => {
    expect(
      resolveDocumentAnnotationAvailability({
        documentKind: "pdf",
        sourceAgentId: "   ",
      }),
    ).toEqual({ state: "missing-agent" });
  });

  it("hides the panel for unsupported preview kinds", () => {
    expect(
      resolveDocumentAnnotationAvailability({
        documentKind: "pptx",
        sourceAgentId: "agent-1",
      }),
    ).toEqual({ state: "hidden" });
    expect(
      resolveDocumentAnnotationAvailability({
        documentKind: null,
        sourceAgentId: "agent-1",
      }),
    ).toEqual({ state: "hidden" });
  });
});
