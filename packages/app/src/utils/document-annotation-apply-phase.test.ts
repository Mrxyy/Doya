import { describe, expect, it } from "vitest";
import {
  shouldPollDocumentAnnotationPreview,
  transitionDocumentAnnotationApplyPhase,
} from "./document-annotation-apply-phase";

describe("document annotation apply phase", () => {
  it("moves from waiting to running when the source agent starts running", () => {
    expect(
      transitionDocumentAnnotationApplyPhase({
        phase: "waiting",
        sourceAgentStatus: "running",
      }),
    ).toEqual({ phase: "running", shouldRefreshPreview: false });
  });

  it("refreshes the preview when a running apply flow finishes", () => {
    expect(
      transitionDocumentAnnotationApplyPhase({
        phase: "running",
        sourceAgentStatus: "idle",
      }),
    ).toEqual({ phase: "idle", shouldRefreshPreview: true });
  });

  it("treats a missing source agent status as finished after running started", () => {
    expect(
      transitionDocumentAnnotationApplyPhase({
        phase: "running",
        sourceAgentStatus: null,
      }),
    ).toEqual({ phase: "idle", shouldRefreshPreview: true });
  });

  it("keeps waiting idle if the source agent has not started yet", () => {
    expect(
      transitionDocumentAnnotationApplyPhase({
        phase: "waiting",
        sourceAgentStatus: "idle",
      }),
    ).toEqual({ phase: "waiting", shouldRefreshPreview: false });
  });

  it("does not infer an apply flow from an idle phase", () => {
    expect(
      transitionDocumentAnnotationApplyPhase({
        phase: "idle",
        sourceAgentStatus: "running",
      }),
    ).toEqual({ phase: "idle", shouldRefreshPreview: false });
  });

  it("polls while an apply flow is waiting or running", () => {
    expect(shouldPollDocumentAnnotationPreview("idle")).toBe(false);
    expect(shouldPollDocumentAnnotationPreview("waiting")).toBe(true);
    expect(shouldPollDocumentAnnotationPreview("running")).toBe(true);
  });
});
