import type { AgentAttachment } from "@getdoya/protocol/messages";
import { releaseAttachmentPreviewUrl, resolveAttachmentPreviewUrl } from "@/attachments/service";
import type { AttachmentMetadata } from "@/attachments/types";
import type { UserMessageImageAttachment } from "@/types/stream";

export type WorkspaceMaterializeAttachment = AttachmentMetadata & {
  fallbackPreviewUrl?: string | null;
};

export interface WorkspaceMaterializedFile {
  id: string;
  cwd?: string;
  title: string;
  mimeType: string;
  path: string;
  url?: string;
  preview?: AttachmentMetadata;
}

interface WorkspaceAttachmentMaterializeClient {
  materializeWorkspaceAttachments(input: {
    cwd?: string;
    agentId?: string;
    files: Array<{
      fileName?: string | null;
      mimeType: string;
      data?: string;
      sourcePath?: string;
      path?: string;
    }>;
  }): Promise<{
    cwd?: string;
    files: Array<{ title: string; mimeType: string; path: string }>;
  }>;
  uploadWorkspaceAttachment?(input: {
    cwd?: string;
    agentId?: string;
    fileName?: string | null;
    mimeType: string;
    body: Blob;
  }): Promise<{
    cwd?: string;
    file: { title: string; mimeType: string; path: string; url?: string };
  }>;
  buildWorkspaceFileRawUrl?(input: { cwd: string; path: string }): string;
}

export async function materializeWorkspaceFileAttachments(input: {
  client: WorkspaceAttachmentMaterializeClient;
  files: readonly WorkspaceMaterializeAttachment[];
  cwd?: string;
  agentId?: string;
}): Promise<AgentAttachment[]> {
  const files = await materializeWorkspaceAttachmentsToFiles(input);
  return workspaceMaterializedFilesToPromptAttachments(files);
}

export async function materializeWorkspaceImageAttachmentsForSubmit(input: {
  client: WorkspaceAttachmentMaterializeClient;
  images: readonly WorkspaceMaterializeAttachment[];
  cwd?: string;
  agentId?: string;
}): Promise<{
  images: UserMessageImageAttachment[];
  attachments: AgentAttachment[];
}> {
  const files = await materializeWorkspaceAttachmentsToFiles({
    client: input.client,
    files: input.images,
    cwd: input.cwd,
    agentId: input.agentId,
  });
  return {
    images: workspaceMaterializedFilesToUserMessageImages(files),
    attachments: workspaceMaterializedFilesToPromptAttachments(files),
  };
}

export async function materializeWorkspaceAttachmentsToFiles(input: {
  client: WorkspaceAttachmentMaterializeClient;
  files: readonly WorkspaceMaterializeAttachment[];
  cwd?: string;
  agentId?: string;
}): Promise<WorkspaceMaterializedFile[]> {
  if (input.files.length === 0) {
    return [];
  }

  const materializedFiles: WorkspaceMaterializedFile[] = [];
  const copyRequests: Array<{
    id: string;
    fileName?: string | null;
    mimeType: string;
    sourcePath?: string;
    preview?: AttachmentMetadata;
  }> = [];
  for (const file of input.files) {
    const title = file.fileName ?? "attached-file";
    if (canUseWorkspaceSourcePath(file)) {
      copyRequests.push({
        id: file.id,
        fileName: title,
        mimeType: file.mimeType,
        sourcePath: file.storageKey,
        preview: file,
      });
      continue;
    }

    const uploadWorkspaceAttachment = input.client.uploadWorkspaceAttachment?.bind(input.client);
    if (uploadWorkspaceAttachment) {
      const uploaded = await uploadAttachmentBodyToWorkspace({
        client: { ...input.client, uploadWorkspaceAttachment },
        cwd: input.cwd,
        agentId: input.agentId,
        file,
        fallbackPreviewUrl: file.fallbackPreviewUrl,
        title,
      });
      const cwd = resolveMaterializedCwd(uploaded, input.cwd);
      materializedFiles.push({
        id: file.id,
        ...uploaded,
        ...(cwd ? { cwd } : {}),
        preview: file,
      });
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
    } = {
      files: copyRequests.map((file) => ({
        fileName: file.fileName,
        mimeType: file.mimeType,
        sourcePath: file.sourcePath,
      })),
    };
    if (input.cwd) {
      request.cwd = input.cwd;
    }
    if (input.agentId) {
      request.agentId = input.agentId;
    }
    const response = await input.client.materializeWorkspaceAttachments(request);
    materializedFiles.push(
      ...response.files.map((file, index) => {
        const request = copyRequests[index];
        const cwd = resolveMaterializedCwd(response, input.cwd);
        return {
          id: request?.id ?? file.path,
          ...file,
          ...(cwd ? { cwd } : {}),
          ...(request?.preview ? { preview: request.preview } : {}),
          ...resolveWorkspaceFileUrl({
            client: input.client,
            cwd: response.cwd || input.cwd,
            path: file.path,
          }),
        };
      }),
    );
  }

  return materializedFiles;
}

export function workspaceMaterializedFilesToPromptAttachments(
  files: readonly Pick<WorkspaceMaterializedFile, "title" | "mimeType" | "path">[],
): AgentAttachment[] {
  return files.map((file) => ({
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

export function workspaceMaterializedFilesToUserMessageImages(
  files: readonly WorkspaceMaterializedFile[],
): UserMessageImageAttachment[] {
  return files.map((file) => ({
    kind: "workspace_image",
    id: file.id,
    ...(file.cwd ? { cwd: file.cwd } : {}),
    path: file.path,
    ...(file.url ? { url: file.url } : {}),
    mimeType: file.mimeType,
    fileName: file.title,
    createdAt: file.preview?.createdAt ?? Date.now(),
  }));
}

function resolveMaterializedCwd(input: { cwd?: string }, fallback?: string): string | undefined {
  const cwd = input.cwd?.trim() || fallback?.trim();
  return cwd || undefined;
}

function canUseWorkspaceSourcePath(file: AttachmentMetadata): boolean {
  return file.storageType === "desktop-file" && file.storageKey.trim().length > 0;
}

async function uploadAttachmentBodyToWorkspace(input: {
  client: WorkspaceAttachmentMaterializeClient & {
    uploadWorkspaceAttachment: NonNullable<
      WorkspaceAttachmentMaterializeClient["uploadWorkspaceAttachment"]
    >;
  };
  cwd?: string;
  agentId?: string;
  file: WorkspaceMaterializeAttachment;
  fallbackPreviewUrl?: string | null;
  title: string;
}): Promise<{ cwd?: string; title: string; mimeType: string; path: string; url?: string }> {
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
    return {
      ...(uploaded.cwd ? { cwd: uploaded.cwd } : {}),
      ...uploaded.file,
      ...resolveWorkspaceFileUrl({
        client: input.client,
        cwd: uploaded.cwd ?? input.cwd,
        path: uploaded.file.path,
      }),
    };
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

function resolveWorkspaceFileUrl(input: {
  client: WorkspaceAttachmentMaterializeClient;
  cwd?: string;
  path: string;
}): { url?: string } {
  if (!input.cwd || !input.client.buildWorkspaceFileRawUrl) {
    return {};
  }
  return {
    url: input.client.buildWorkspaceFileRawUrl({
      cwd: input.cwd,
      path: input.path,
    }),
  };
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
