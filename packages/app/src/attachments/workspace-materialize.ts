import type { AgentAttachment } from "@getpaseo/protocol/messages";
import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";

export type WorkspaceMaterializeAttachment = AttachmentMetadata & {
  fallbackPreviewUrl?: string | null;
};

interface WorkspaceAttachmentMaterializeClient {
  materializeWorkspaceAttachments(input: {
    cwd?: string;
    agentId?: string;
    files: Array<{
      fileName?: string | null;
      mimeType: string;
      data?: string;
      sourcePath?: string;
    }>;
  }): Promise<{
    files: Array<{ title: string; mimeType: string; path: string }>;
  }>;
  uploadWorkspaceAttachment?(input: {
    cwd?: string;
    agentId?: string;
    fileName?: string | null;
    mimeType: string;
    body: Blob;
  }): Promise<{
    file: { title: string; mimeType: string; path: string };
  }>;
}

export async function materializeWorkspaceFileAttachments(input: {
  client: WorkspaceAttachmentMaterializeClient;
  files: readonly WorkspaceMaterializeAttachment[];
  cwd?: string;
  agentId?: string;
}): Promise<AgentAttachment[]> {
  if (input.files.length === 0) {
    return [];
  }

  const materializedFiles: Array<{ title: string; mimeType: string; path: string }> = [];
  const copyRequests: Array<{
    fileName?: string | null;
    mimeType: string;
    sourcePath?: string;
  }> = [];
  for (const file of input.files) {
    const title = file.fileName ?? "attached-file";
    if (canUseWorkspaceSourcePath(file)) {
      copyRequests.push({
        fileName: title,
        mimeType: file.mimeType,
        sourcePath: file.storageKey,
      });
      continue;
    }

    const uploadWorkspaceAttachment = input.client.uploadWorkspaceAttachment?.bind(input.client);
    if (uploadWorkspaceAttachment) {
      const uploaded = await uploadAttachmentBodyToWorkspace({
        client: { uploadWorkspaceAttachment },
        cwd: input.cwd,
        agentId: input.agentId,
        file,
        fallbackPreviewUrl: file.fallbackPreviewUrl,
        title,
      });
      materializedFiles.push(uploaded);
      continue;
    }

    throw new Error(
      `Failed to upload attachment "${title}" to the workspace. Update the host to support direct file uploads.`,
    );
  }

  if (copyRequests.length > 0) {
    const request: {
      cwd?: string;
      agentId?: string;
      files: Array<{
        fileName?: string | null;
        mimeType: string;
        sourcePath?: string;
      }>;
    } = { files: copyRequests };
    if (input.cwd) {
      request.cwd = input.cwd;
    }
    if (input.agentId) {
      request.agentId = input.agentId;
    }
    const response = await input.client.materializeWorkspaceAttachments(request);
    materializedFiles.push(...response.files);
  }

  return materializedFiles.map((file) => ({
    type: "text",
    mimeType: "text/plain",
    title: file.title,
    text: [
      `Uploaded file: ${file.title}`,
      `MIME type: ${file.mimeType}`,
      `Workspace path: ${file.path}`,
      "Use the workspace path above when the user asks about this file.",
    ].join("\n"),
  }));
}

function canUseWorkspaceSourcePath(file: AttachmentMetadata): boolean {
  return file.storageType === "desktop-file" && file.storageKey.trim().length > 0;
}

async function uploadAttachmentBodyToWorkspace(input: {
  client: Required<Pick<WorkspaceAttachmentMaterializeClient, "uploadWorkspaceAttachment">>;
  cwd?: string;
  agentId?: string;
  file: WorkspaceMaterializeAttachment;
  fallbackPreviewUrl?: string | null;
  title: string;
}): Promise<{ title: string; mimeType: string; path: string }> {
  let previewUrl: string | null = null;
  let shouldReleasePreviewUrl = false;
  try {
    if (input.fallbackPreviewUrl) {
      previewUrl = input.fallbackPreviewUrl;
    } else {
      previewUrl = await resolveAttachmentPreviewUrl(input.file);
      shouldReleasePreviewUrl = true;
    }
    const body = await fetchAttachmentBody({
      url: previewUrl,
      fallbackUrl:
        input.fallbackPreviewUrl && input.fallbackPreviewUrl !== previewUrl
          ? input.fallbackPreviewUrl
          : null,
      title: input.title,
      attachmentId: input.file.id,
    });
    const uploaded = await input.client.uploadWorkspaceAttachment({
      cwd: input.cwd,
      agentId: input.agentId,
      fileName: input.title,
      mimeType: input.file.mimeType,
      body,
    });
    return uploaded.file;
  } catch (error) {
    console.error("[attachments] Failed to upload attachment body to workspace", {
      attachmentId: input.file.id,
      title: input.title,
      storageType: input.file.storageType,
      storageKey: input.file.storageKey,
      error,
    });
    throw new Error(
      `Failed to upload attachment "${input.title}" to the workspace. Remove it and upload it again.`,
      { cause: error },
    );
  } finally {
    if (previewUrl && shouldReleasePreviewUrl) {
      await Promise.resolve(
        releaseAttachmentPreviewUrl({ attachment: input.file, url: previewUrl }),
      ).catch(() => undefined);
    }
  }
}

async function fetchAttachmentBody(input: {
  url: string;
  fallbackUrl: string | null;
  title: string;
  attachmentId: string;
}): Promise<Blob> {
  try {
    return await fetchBlob(input.url);
  } catch (error) {
    if (!input.fallbackUrl) {
      throw error;
    }
    console.warn("[attachments] Retrying attachment upload from fallback preview URL", {
      attachmentId: input.attachmentId,
      title: input.title,
      error,
    });
    return await fetchBlob(input.fallbackUrl);
  }
}

async function fetchBlob(url: string): Promise<Blob> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to read attachment body (${response.status}).`);
  }
  return await response.blob();
}
