import type { AttachmentMetadata, ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment } from "@/composer/types";
import type { UserMessageImageAttachment } from "@/types/stream";
import { encodeFilesAsTextAttachments } from "@/attachments/text-file";
import {
  isWorkspaceAttachment,
  workspaceAttachmentToSubmitAttachment,
} from "@/attachments/workspace-attachment-utils";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { buildGitHubAttachmentFromSearchItem } from "@/utils/review-attachments";

export async function splitComposerAttachmentsForSubmit(
  attachments: ComposerAttachment[],
  options: {
    materializeFiles?: (files: readonly AttachmentMetadata[]) => Promise<AgentAttachment[]>;
    materializeImages?: (images: readonly AttachmentMetadata[]) => Promise<{
      images: UserMessageImageAttachment[];
      attachments: AgentAttachment[];
    }>;
  } = {},
): Promise<{
  images: ImageAttachment[];
  displayImages: UserMessageImageAttachment[];
  attachments: AgentAttachment[];
  displayAttachments: AgentAttachment[];
}> {
  const images: ImageAttachment[] = [];
  const files: AttachmentMetadata[] = [];
  const agentAttachments: AgentAttachment[] = [];
  const displayAttachments: AgentAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      images.push(attachment.metadata);
      continue;
    }

    if (attachment.kind === "file") {
      files.push(attachment.metadata);
      displayAttachments.push({
        type: "file",
        mimeType: attachment.metadata.mimeType,
        title: attachment.metadata.fileName ?? "File attachment",
      });
      continue;
    }

    if (isWorkspaceAttachment(attachment)) {
      const workspaceAttachment = workspaceAttachmentToSubmitAttachment(attachment);
      if (workspaceAttachment) {
        agentAttachments.push(workspaceAttachment);
        displayAttachments.push(workspaceAttachment);
      }
      continue;
    }

    const reviewAttachment = buildGitHubAttachmentFromSearchItem(attachment.item);
    if (reviewAttachment) {
      agentAttachments.push(reviewAttachment);
      displayAttachments.push(reviewAttachment);
    }
  }

  const materializedImages =
    images.length > 0 && options.materializeImages ? await options.materializeImages(images) : null;
  const sendImages = materializedImages ? [] : images;
  const displayImages = materializedImages?.images ?? images;
  const imageTextAttachments = materializedImages?.attachments ?? [];
  const textFileAttachments =
    files.length > 0 && options.materializeFiles
      ? await options.materializeFiles(files)
      : await encodeFilesAsTextAttachments(files);
  return {
    images: sendImages,
    displayImages,
    attachments: [...agentAttachments, ...imageTextAttachments, ...textFileAttachments],
    displayAttachments,
  };
}
