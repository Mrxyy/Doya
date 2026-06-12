import { describe, expect, it } from "vitest";
import type { DocumentAnnotationTarget } from "@/components/document-viewer";
import {
  getDocumentAnnotationControllerView,
  initialDocumentAnnotationControllerState,
  reduceDocumentAnnotationControllerState,
} from "./document-annotation-controller";

const target: DocumentAnnotationTarget = {
  kind: "xlsx",
  label: "Budget!C2",
  locator: {
    type: "cell",
    sheet: "Budget",
    cell: "C2",
    row: 2,
    column: 3,
  },
  context: "150000",
};

describe("document annotation controller", () => {
  it("tracks mode, selected target, and add/apply availability", () => {
    let state = initialDocumentAnnotationControllerState;
    expect(getDocumentAnnotationControllerView(state)).toMatchObject({
      canAddAnnotation: false,
      canApplyAnnotations: false,
      modeButtonLabel: "开始标注",
      modeButtonVariant: "outline",
    });

    state = reduceDocumentAnnotationControllerState(state, { type: "toggle_mode" });
    state = reduceDocumentAnnotationControllerState(state, { type: "select_target", target });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "set_instruction",
      instruction: "  改成 20 万  ",
    });

    expect(getDocumentAnnotationControllerView(state)).toMatchObject({
      canAddAnnotation: true,
      canApplyAnnotations: false,
      modeButtonLabel: "选择中",
      modeButtonVariant: "default",
    });

    state = reduceDocumentAnnotationControllerState(state, {
      type: "add_annotation",
      id: "annotation-1",
    });

    expect(state.annotationInstruction).toBe("");
    expect(state.pendingAnnotations).toEqual([
      {
        id: "annotation-1",
        target,
        instruction: "改成 20 万",
      },
    ]);
    expect(getDocumentAnnotationControllerView(state)).toMatchObject({
      hasPendingAnnotations: true,
      canApplyAnnotations: true,
    });
  });

  it("does not add annotations without both a target and non-empty instruction", () => {
    let state = reduceDocumentAnnotationControllerState(initialDocumentAnnotationControllerState, {
      type: "set_instruction",
      instruction: "改一下",
    });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "add_annotation",
      id: "annotation-1",
    });
    expect(state.pendingAnnotations).toEqual([]);

    state = reduceDocumentAnnotationControllerState(state, { type: "select_target", target });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "set_instruction",
      instruction: "   ",
    });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "add_annotation",
      id: "annotation-2",
    });
    expect(state.pendingAnnotations).toEqual([]);
  });

  it("removes annotations and clears transient state after a successful apply", () => {
    let state = reduceDocumentAnnotationControllerState(initialDocumentAnnotationControllerState, {
      type: "select_target",
      target,
    });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "set_instruction",
      instruction: "改成红色",
    });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "add_annotation",
      id: "annotation-1",
    });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "remove_annotation",
      id: "missing",
    });
    expect(state.pendingAnnotations).toHaveLength(1);

    state = reduceDocumentAnnotationControllerState(state, {
      type: "remove_annotation",
      id: "annotation-1",
    });
    expect(state.pendingAnnotations).toEqual([]);

    state = reduceDocumentAnnotationControllerState(state, { type: "select_target", target });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "set_instruction",
      instruction: "改成蓝色",
    });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "add_annotation",
      id: "annotation-2",
    });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "set_apply_phase",
      phase: "waiting",
    });
    state = reduceDocumentAnnotationControllerState(state, {
      type: "clear_after_apply_success",
    });

    expect(state).toMatchObject({
      selectedAnnotationTarget: null,
      annotationInstruction: "",
      pendingAnnotations: [],
      applyPhase: "idle",
    });
  });
});
