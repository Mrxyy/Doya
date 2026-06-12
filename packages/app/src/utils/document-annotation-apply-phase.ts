export type DocumentAnnotationApplyPhase = "idle" | "waiting" | "running";

export interface DocumentAnnotationApplyPhaseTransition {
  phase: DocumentAnnotationApplyPhase;
  shouldRefreshPreview: boolean;
}

export function transitionDocumentAnnotationApplyPhase(input: {
  phase: DocumentAnnotationApplyPhase;
  sourceAgentStatus: string | null;
}): DocumentAnnotationApplyPhaseTransition {
  if (input.phase === "waiting" && input.sourceAgentStatus === "running") {
    return { phase: "running", shouldRefreshPreview: false };
  }
  if (input.phase === "running" && input.sourceAgentStatus !== "running") {
    return { phase: "idle", shouldRefreshPreview: true };
  }
  return { phase: input.phase, shouldRefreshPreview: false };
}

export function shouldPollDocumentAnnotationPreview(phase: DocumentAnnotationApplyPhase): boolean {
  return phase !== "idle";
}
