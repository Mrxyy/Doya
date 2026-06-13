import type { AttachmentMetadata } from "@/attachments/types";
import { isWeb } from "@/constants/platform";

const STORAGE_KEY = "doya:ai-creation-edit-source:v1";

type EditableAttachmentMetadata = AttachmentMetadata & {
  fallbackPreviewUrl?: string | null;
};

export interface AiCreationEditSource {
  entry: "result-edit";
  image: EditableAttachmentMetadata;
  previewUri: string;
  imageSource: string;
  sourceAgentId: string;
  sourceServerId: string;
}

let editSource: AiCreationEditSource | null = null;

export function setAiCreationEditSource(source: AiCreationEditSource): void {
  editSource = source;
  saveStoredEditSource(source);
}

export function takeAiCreationEditSource(): AiCreationEditSource | null {
  const source = editSource ?? loadStoredEditSource();
  editSource = null;
  return source;
}

export function clearAiCreationEditSource(): void {
  editSource = null;
  if (!isWeb) {
    return;
  }
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures; the in-memory path still works for this navigation.
  }
}

function saveStoredEditSource(source: AiCreationEditSource): void {
  if (!isWeb) {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(source));
  } catch {
    // Ignore storage failures; the in-memory path still works for this navigation.
  }
}

function loadStoredEditSource(): AiCreationEditSource | null {
  if (!isWeb) {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    return isAiCreationEditSource(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isAiCreationEditSource(value: unknown): value is AiCreationEditSource {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    record.entry === "result-edit" &&
    isEditableAttachmentMetadata(record.image) &&
    typeof record.previewUri === "string" &&
    typeof record.imageSource === "string" &&
    typeof record.sourceAgentId === "string" &&
    typeof record.sourceServerId === "string"
  );
}

function isEditableAttachmentMetadata(value: unknown): value is EditableAttachmentMetadata {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.mimeType === "string" &&
    typeof record.storageType === "string" &&
    typeof record.storageKey === "string" &&
    typeof record.createdAt === "number"
  );
}
