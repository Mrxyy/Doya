import type { DocumentAnnotationTarget } from "@/components/document-viewer";
import type { DocumentAnnotationApplyPhase } from "@/utils/document-annotation-apply-phase";

export interface PendingDocumentAnnotation {
  id: string;
  target: DocumentAnnotationTarget;
  instruction: string;
}

export interface DocumentAnnotationControllerState {
  annotationMode: boolean;
  selectedAnnotationTarget: DocumentAnnotationTarget | null;
  annotationInstruction: string;
  pendingAnnotations: PendingDocumentAnnotation[];
  applyPhase: DocumentAnnotationApplyPhase;
}

export interface DocumentAnnotationControllerView {
  hasPendingAnnotations: boolean;
  canAddAnnotation: boolean;
  canApplyAnnotations: boolean;
  modeButtonLabel: string;
  modeButtonVariant: "default" | "outline";
}

export type DocumentAnnotationControllerAction =
  | { type: "reset" }
  | { type: "toggle_mode" }
  | { type: "select_target"; target: DocumentAnnotationTarget }
  | { type: "set_instruction"; instruction: string }
  | { type: "add_annotation"; id: string }
  | { type: "remove_annotation"; id: string }
  | { type: "set_apply_phase"; phase: DocumentAnnotationApplyPhase }
  | { type: "clear_after_apply_success" };

export const initialDocumentAnnotationControllerState: DocumentAnnotationControllerState = {
  annotationMode: false,
  selectedAnnotationTarget: null,
  annotationInstruction: "",
  pendingAnnotations: [],
  applyPhase: "idle",
};

export function reduceDocumentAnnotationControllerState(
  state: DocumentAnnotationControllerState,
  action: DocumentAnnotationControllerAction,
): DocumentAnnotationControllerState {
  switch (action.type) {
    case "reset":
      return initialDocumentAnnotationControllerState;
    case "toggle_mode":
      return { ...state, annotationMode: !state.annotationMode };
    case "select_target":
      return { ...state, selectedAnnotationTarget: action.target };
    case "set_instruction":
      return { ...state, annotationInstruction: action.instruction };
    case "add_annotation": {
      const instruction = state.annotationInstruction.trim();
      if (!state.selectedAnnotationTarget || !instruction) {
        return state;
      }
      return {
        ...state,
        annotationInstruction: "",
        pendingAnnotations: [
          ...state.pendingAnnotations,
          {
            id: action.id,
            target: state.selectedAnnotationTarget,
            instruction,
          },
        ],
      };
    }
    case "remove_annotation":
      return {
        ...state,
        pendingAnnotations: state.pendingAnnotations.filter(
          (annotation) => annotation.id !== action.id,
        ),
      };
    case "set_apply_phase":
      return { ...state, applyPhase: action.phase };
    case "clear_after_apply_success":
      return {
        ...state,
        selectedAnnotationTarget: null,
        annotationInstruction: "",
        pendingAnnotations: [],
        applyPhase: "idle",
      };
    default:
      return state;
  }
}

export function getDocumentAnnotationControllerView(
  state: DocumentAnnotationControllerState,
): DocumentAnnotationControllerView {
  return {
    hasPendingAnnotations: state.pendingAnnotations.length > 0,
    canAddAnnotation: Boolean(state.selectedAnnotationTarget && state.annotationInstruction.trim()),
    canApplyAnnotations: state.pendingAnnotations.length > 0 && state.applyPhase === "idle",
    modeButtonLabel: state.annotationMode ? "选择中" : "开始标注",
    modeButtonVariant: state.annotationMode ? "default" : "outline",
  };
}
