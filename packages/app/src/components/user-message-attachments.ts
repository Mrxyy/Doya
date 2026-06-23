import type { AgentAttachment } from "@getdoya/protocol/messages";
import type { AttachmentMetadata } from "@/attachments/types";
import type { UserMessageImageAttachment } from "@/types/stream";

export function filterUserMessageDisplayAttachments(input: {
  images: readonly UserMessageImageAttachment[];
  attachments: readonly AgentAttachment[];
  selectionImage?: AttachmentMetadata;
  selectionImageSource?: string;
  selectionPreviewUri?: string;
}): AgentAttachment[] {
  const hasDisplayedImage = input.images.length > 0;
  const imageKeys = new Set<string>();
  for (const image of input.images) {
    if (isWorkspaceUserMessageImage(image)) {
      addComparableKeys(imageKeys, image.path);
      addComparableKeys(imageKeys, image.fileName ?? null);
    }
  }
  addSelectionReferenceKeys(imageKeys, input);
  if (!hasDisplayedImage && imageKeys.size === 0) {
    return [...input.attachments];
  }
  return input.attachments.filter((attachment) => {
    if (!isImageLikeAttachment(attachment)) {
      return true;
    }
    if (hasDisplayedImage) {
      return false;
    }
    const attachmentKeys = getAttachmentComparableKeys(attachment);
    return !attachmentKeys.some((key) => imageKeys.has(key));
  });
}

function addSelectionReferenceKeys(
  keys: Set<string>,
  input: {
    selectionImage?: AttachmentMetadata;
    selectionImageSource?: string;
    selectionPreviewUri?: string;
  },
): void {
  const hasSelectionReference = Boolean(
    input.selectionImage || input.selectionImageSource || input.selectionPreviewUri,
  );
  if (!hasSelectionReference) {
    return;
  }
  const selectionImage = input.selectionImage;
  if (selectionImage) {
    addComparableKeys(keys, selectionImage.fileName ?? null);
  }
  addComparableKeys(keys, input.selectionImageSource);
  addComparableKeys(keys, input.selectionPreviewUri);
}

function isWorkspaceUserMessageImage(
  image: UserMessageImageAttachment,
): image is Extract<UserMessageImageAttachment, { kind: "workspace_image" }> {
  return "kind" in image && image.kind === "workspace_image";
}

function getAttachmentComparableKeys(attachment: AgentAttachment): string[] {
  const keys = new Set<string>();
  addComparableKeys(keys, "title" in attachment ? (attachment.title ?? null) : null);
  addComparableKeys(keys, extractWorkspacePathFromUserAttachment(attachment));
  return [...keys];
}

function extractWorkspacePathFromUserAttachment(attachment: AgentAttachment): string | null {
  if (attachment.type !== "text") {
    return null;
  }
  const match = attachment.text.match(/^Workspace path:\s*(.+)$/m);
  return match?.[1]?.trim() || null;
}

function isImageLikeAttachment(attachment: AgentAttachment): boolean {
  const mimeType =
    attachment.type === "text"
      ? extractMimeTypeFromUserAttachment(attachment) || attachment.mimeType
      : attachment.mimeType;
  return mimeType.toLowerCase().startsWith("image/");
}

function extractMimeTypeFromUserAttachment(attachment: AgentAttachment): string | null {
  if (attachment.type !== "text") {
    return null;
  }
  const match = attachment.text.match(/^MIME type:\s*(.+)$/m);
  return match?.[1]?.trim() || null;
}

function addComparableKeys(keys: Set<string>, value: string | null | undefined): void {
  const normalized = normalizeComparablePath(value);
  if (!normalized) {
    return;
  }
  keys.add(normalized);
  const attachmentIndex = normalized.lastIndexOf("/attachments/");
  if (attachmentIndex >= 0) {
    keys.add(normalized.slice(attachmentIndex + 1));
  }
  const fileName = normalized.split("/").pop();
  if (fileName) {
    keys.add(fileName);
  }
}

function normalizeComparablePath(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed
    .replace(/^file:\/\//u, "")
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/+/gu, "/");
}
