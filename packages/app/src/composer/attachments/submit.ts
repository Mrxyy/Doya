import type { ComposerAttachment } from "@/attachments/types";
import type { ImageAttachment } from "@/composer/types";
import { encodeFilesAsTextAttachments } from "@/attachments/text-file";
import {
  isWorkspaceAttachment,
  workspaceAttachmentToSubmitAttachment,
} from "@/attachments/workspace-attachment-utils";
import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { buildGitHubAttachmentFromSearchItem } from "@/utils/review-attachments";

export async function splitComposerAttachmentsForSubmit(
  attachments: ComposerAttachment[],
): Promise<{
  images: ImageAttachment[];
  attachments: AgentAttachment[];
}> {
  const images: ImageAttachment[] = [];
  const files: ImageAttachment[] = [];
  const agentAttachments: AgentAttachment[] = [];

  for (const attachment of attachments) {
    if (attachment.kind === "image") {
      images.push(attachment.metadata);
      continue;
    }

    if (attachment.kind === "file") {
      files.push(attachment.metadata);
      continue;
    }

    if (isWorkspaceAttachment(attachment)) {
      const workspaceAttachment = workspaceAttachmentToSubmitAttachment(attachment);
      if (workspaceAttachment) {
        agentAttachments.push(workspaceAttachment);
      }
      continue;
    }

    const reviewAttachment = buildGitHubAttachmentFromSearchItem(attachment.item);
    if (reviewAttachment) {
      agentAttachments.push(reviewAttachment);
    }
  }

  const textFileAttachments = await encodeFilesAsTextAttachments(files);
  return {
    images,
    attachments: [...agentAttachments, ...textFileAttachments],
  };
}
